import * as THREE from 'three';
import { createTessellationMaterial } from './ShapeTessellationShader.js';

export class ShapeManager {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.renderOrder = 1.5;
        this.scene.add(this.group);

        // Anchor tracking
        this.anchors = [];
        this.fadingAnchors = [];

        // Internal tessellation
        this.tessellationMesh = null;
        this.tessellationMaterial = null;
        this.shapeFormedTime = 0;
        this.lastShapeType = 'none';
        this.tessellationActive = false;

        this.PINCH_THRESHOLD = 30; // pixels screen space
        this.SMOOTH_FACTOR = 0.3;
        this.FADE_DURATION = 150; // ms

        // --- Pre-allocate node pool (6 nodes for active + 6 for fading) ---
        this.nodePool = [];
        for (let i = 0; i < 12; i++) {
            const squareGeom = new THREE.PlaneGeometry(20, 20);
            const squareMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 1,
                depthTest: false,
                side: THREE.DoubleSide
            });
            const squareMesh = new THREE.Mesh(squareGeom, squareMat);
            squareMesh.rotation.z = Math.PI / 4;
            squareMesh.visible = false;

            const dotGeom = new THREE.CircleGeometry(4, 16);
            const dotMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 1,
                depthTest: false,
                side: THREE.DoubleSide
            });
            const dotMesh = new THREE.Mesh(dotGeom, dotMat);
            dotMesh.visible = false;

            this.group.add(squareMesh);
            this.group.add(dotMesh);
            this.nodePool.push({ square: squareMesh, dot: dotMesh });
        }

        // --- Pre-allocate edge pool (12 edges) ---
        this.edgePool = [];
        for (let i = 0; i < 12; i++) {
            const positions = new Float32Array(4 * 3); // 4 vertices × 3 coords
            const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geom.setIndex(new THREE.BufferAttribute(indices, 1));

            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 1,
                depthTest: false,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.visible = false;

            this.group.add(mesh);
            this.edgePool.push(mesh);
        }
    }

    update(handsData, canvasWidth, canvasHeight) {
        const now = performance.now();

        // --- Hide all pooled meshes ---
        for (const node of this.nodePool) {
            node.square.visible = false;
            node.dot.visible = false;
        }
        for (const edge of this.edgePool) {
            edge.visible = false;
        }

        if (!handsData) handsData = [];

        // --- Detect anchors from each hand ---
        const rawAnchors = [];

        for (let h = 0; h < handsData.length; h++) {
            const points3D = handsData[h];
            if (!points3D || points3D.length < 21) continue;

            const thumbTip = points3D[4];
            const indexTip = points3D[8];
            const middleTip = points3D[12];
            const middleDip = points3D[10]; // for extension check

            // Compute average z across all landmarks for depth
            let avgZ = 0;
            for (let l = 0; l < 21; l++) {
                avgZ += points3D[l].z;
            }
            avgZ /= 21;

            // Distance between thumb and index
            const dx = thumbTip.x - indexTip.x;
            const dy = thumbTip.y - indexTip.y;
            const thumbIndexDist = Math.sqrt(dx * dx + dy * dy);

            // Check if middle finger is extended (tip significantly above dip in y)
            const middleExtended = (middleDip.y - middleTip.y) > 15;

            if (thumbIndexDist < this.PINCH_THRESHOLD) {
                // PINCHING — thumb+index merge into 1 anchor at midpoint
                rawAnchors.push({
                    position: new THREE.Vector3(
                        (thumbTip.x + indexTip.x) / 2,
                        (thumbTip.y + indexTip.y) / 2,
                        0
                    ),
                    id: `h${h}_pinch`,
                    avgZ
                });

                // If middle finger extended while pinching, add it as a 2nd anchor
                if (middleExtended) {
                    rawAnchors.push({
                        position: new THREE.Vector3(middleTip.x, middleTip.y, 0),
                        id: `h${h}_middle`,
                        avgZ
                    });
                }
            } else {
                // NOT PINCHING — thumb and index are separate anchors
                rawAnchors.push({
                    position: new THREE.Vector3(thumbTip.x, thumbTip.y, 0),
                    id: `h${h}_thumb`,
                    avgZ
                });
                rawAnchors.push({
                    position: new THREE.Vector3(indexTip.x, indexTip.y, 0),
                    id: `h${h}_index`,
                    avgZ
                });

                // If middle finger extended, add it too
                if (middleExtended) {
                    rawAnchors.push({
                        position: new THREE.Vector3(middleTip.x, middleTip.y, 0),
                        id: `h${h}_middle`,
                        avgZ
                    });
                }
            }
        }

        // --- Match raw anchors to existing anchors by id ---
        const matchedIds = new Set();
        const newAnchors = [];

        for (let r = 0; r < rawAnchors.length; r++) {
            const raw = rawAnchors[r];
            let found = false;

            for (let a = 0; a < this.anchors.length; a++) {
                if (matchedIds.has(this.anchors[a].id)) continue;
                if (this.anchors[a].id === raw.id) {
                    // Update existing anchor with smoothing
                    const anchor = this.anchors[a];
                    anchor.smoothed.x += (raw.position.x - anchor.smoothed.x) * this.SMOOTH_FACTOR;
                    anchor.smoothed.y += (raw.position.y - anchor.smoothed.y) * this.SMOOTH_FACTOR;
                    anchor.depthScale = this._computeDepthScale(raw.avgZ);
                    anchor.avgZ = raw.avgZ;
                    newAnchors.push(anchor);
                    matchedIds.add(anchor.id);
                    found = true;
                    break;
                }
            }

            if (!found) {
                // New anchor — birth it
                newAnchors.push({
                    smoothed: raw.position.clone(),
                    id: raw.id,
                    birthTime: now,
                    depthScale: this._computeDepthScale(raw.avgZ),
                    avgZ: raw.avgZ
                });
            }
        }

        // Anchors that disappeared — move to fading
        for (let a = 0; a < this.anchors.length; a++) {
            if (!matchedIds.has(this.anchors[a].id)) {
                const dying = this.anchors[a];
                dying.fadeStartTime = now;
                this.fadingAnchors.push(dying);
            }
        }

        this.anchors = newAnchors;

        // --- Update fading anchors, remove expired ---
        this.fadingAnchors = this.fadingAnchors.filter(fa => (now - fa.fadeStartTime) < this.FADE_DURATION);

        // --- Determine shape type ---
        const activeCount = this.anchors.length;
        let shapeType = 'none';
        if (activeCount === 2) shapeType = 'line';
        else if (activeCount === 3) shapeType = 'triangle';
        else if (activeCount >= 4) shapeType = 'quad';

        // --- Render active anchor nodes (using pool) ---
        let nodeIdx = 0;
        for (let i = 0; i < this.anchors.length && nodeIdx < this.nodePool.length; i++, nodeIdx++) {
            const anc = this.anchors[i];
            const age = now - anc.birthTime;
            const fadeIn = Math.min(1, age / this.FADE_DURATION);
            const scale = anc.depthScale;
            const node = this.nodePool[nodeIdx];

            node.square.visible = true;
            node.square.position.set(anc.smoothed.x, anc.smoothed.y, 3);
            node.square.scale.set(scale, scale, 1);
            node.square.material.opacity = fadeIn;

            node.dot.visible = true;
            node.dot.position.set(anc.smoothed.x, anc.smoothed.y, 3.01);
            node.dot.scale.set(scale, scale, 1);
            node.dot.material.opacity = fadeIn;
        }

        // --- Render fading anchor nodes (using pool) ---
        for (let i = 0; i < this.fadingAnchors.length && nodeIdx < this.nodePool.length; i++, nodeIdx++) {
            const fa = this.fadingAnchors[i];
            const fadeOut = 1 - Math.min(1, (now - fa.fadeStartTime) / this.FADE_DURATION);
            const scale = fa.depthScale;
            const node = this.nodePool[nodeIdx];

            node.square.visible = true;
            node.square.position.set(fa.smoothed.x, fa.smoothed.y, 3);
            node.square.scale.set(scale, scale, 1);
            node.square.material.opacity = fadeOut;

            node.dot.visible = true;
            node.dot.position.set(fa.smoothed.x, fa.smoothed.y, 3.01);
            node.dot.scale.set(scale, scale, 1);
            node.dot.material.opacity = fadeOut;
        }

        // --- Render edges (using pool) ---
        if (shapeType !== 'none') {
            this._drawEdges(shapeType, now);
        }

        // --- Internal tessellation for closed shapes ---
        if (shapeType === 'triangle' || shapeType === 'quad') {
            if (shapeType !== this.lastShapeType) {
                this.shapeFormedTime = now;
                this.lastShapeType = shapeType;
                this.tessellationActive = false;
            }

            if (!this.tessellationActive && (now - this.shapeFormedTime) > 200) {
                this.tessellationActive = true;
                this._createTessellationMesh(canvasWidth, canvasHeight);
            }

            if (this.tessellationActive && this.tessellationMaterial) {
                this.tessellationMaterial.uniforms.u_time.value = now * 0.001;
                this.tessellationMaterial.uniforms.u_vertexCount.value = (shapeType === 'triangle') ? 3 : 4;
                this.tessellationMaterial.uniforms.u_resolution.value.set(canvasWidth, canvasHeight);

                for (let v = 0; v < 4; v++) {
                    if (v < this.anchors.length) {
                        this.tessellationMaterial.uniforms.u_vertices.value[v].set(
                            this.anchors[v].smoothed.x / (canvasWidth / 2),
                            this.anchors[v].smoothed.y / (canvasHeight / 2)
                        );
                    }
                }
            }
        } else {
            if (this.tessellationActive) {
                this._removeTessellationMesh();
                this.tessellationActive = false;
            }
            this.lastShapeType = shapeType;
        }
    }

    _computeDepthScale(avgZ) {
        // Map z from [-0.2, 0] to [3.0, 0.5] (DRAMATIC range)
        const t = Math.max(0, Math.min(1, (avgZ - (-0.2)) / (0 - (-0.2))));
        return 3.0 + t * (0.5 - 3.0); // lerp from 3.0 (close) to 0.5 (far)
    }

    _drawEdges(shapeType, now) {
        const z = 3;
        const anchors = this.anchors;

        // Compute min opacity from birth fades
        let minOpacity = 1;
        for (let i = 0; i < anchors.length; i++) {
            const age = now - anchors[i].birthTime;
            const fade = Math.min(1, age / this.FADE_DURATION);
            if (fade < minOpacity) minOpacity = fade;
        }

        // Average depth scale for edge width
        let avgDepthScale = 0;
        for (let i = 0; i < anchors.length; i++) {
            avgDepthScale += anchors[i].depthScale;
        }
        avgDepthScale /= anchors.length;

        const edgeWidth = 4 * avgDepthScale;

        // Build edge pairs
        const edges = [];
        if (shapeType === 'line') {
            // Two parallel lines offset ±3px perpendicular
            const a = anchors[0].smoothed;
            const b = anchors[1].smoothed;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) return;
            const nx = -dy / len * 3;
            const ny = dx / len * 3;

            edges.push([
                new THREE.Vector3(a.x + nx, a.y + ny, z),
                new THREE.Vector3(b.x + nx, b.y + ny, z)
            ]);
            edges.push([
                new THREE.Vector3(a.x - nx, a.y - ny, z),
                new THREE.Vector3(b.x - nx, b.y - ny, z)
            ]);
        } else if (shapeType === 'triangle') {
            for (let i = 0; i < 3; i++) {
                const j = (i + 1) % 3;
                edges.push([
                    new THREE.Vector3(anchors[i].smoothed.x, anchors[i].smoothed.y, z),
                    new THREE.Vector3(anchors[j].smoothed.x, anchors[j].smoothed.y, z)
                ]);
            }
        } else if (shapeType === 'quad') {
            const count = Math.min(anchors.length, 4);
            for (let i = 0; i < count; i++) {
                const j = (i + 1) % count;
                edges.push([
                    new THREE.Vector3(anchors[i].smoothed.x, anchors[i].smoothed.y, z),
                    new THREE.Vector3(anchors[j].smoothed.x, anchors[j].smoothed.y, z)
                ]);
            }
        }

        // Render each edge by updating pre-allocated buffer geometry
        for (let e = 0; e < edges.length && e < this.edgePool.length; e++) {
            const pA = edges[e][0];
            const pB = edges[e][1];

            const dx = pB.x - pA.x;
            const dy = pB.y - pA.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) continue;

            // Perpendicular direction for width
            const nx = -dy / len * (edgeWidth / 2);
            const ny = dx / len * (edgeWidth / 2);

            const mesh = this.edgePool[e];
            const posAttr = mesh.geometry.getAttribute('position');
            const arr = posAttr.array;

            // 4 vertices forming a thin rectangle
            arr[0] = pA.x + nx; arr[1] = pA.y + ny; arr[2] = z;
            arr[3] = pA.x - nx; arr[4] = pA.y - ny; arr[5] = z;
            arr[6] = pB.x - nx; arr[7] = pB.y - ny; arr[8] = z;
            arr[9] = pB.x + nx; arr[10] = pB.y + ny; arr[11] = z;

            posAttr.needsUpdate = true;
            mesh.material.opacity = minOpacity;
            mesh.visible = true;
        }
    }

    getShapeState() {
        const count = this.anchors.length;
        let type = 'none';
        if (count === 2) type = 'line';
        else if (count === 3) type = 'triangle';
        else if (count >= 4) type = 'quad';

        const anchorPositions = this.anchors.map(a => a.smoothed.clone());
        return { type, anchors: anchorPositions };
    }

    getAnchors() {
        return this.anchors.map(a => a.smoothed.clone());
    }

    getAverageDepth() {
        if (this.anchors.length === 0) return 0;
        let sum = 0;
        for (let i = 0; i < this.anchors.length; i++) {
            sum += this.anchors[i].avgZ;
        }
        return sum / this.anchors.length;
    }

    getShapeArea() {
        if (this.anchors.length < 3) return 0;
        const points = this.anchors.map(a => a.smoothed);
        let area = 0;
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        area = Math.abs(area) / 2;
        return Math.min(1, area / 200000);
    }

    _createTessellationMesh(canvasWidth, canvasHeight) {
        this._removeTessellationMesh();
        this.tessellationMaterial = createTessellationMaterial();
        this.tessellationMaterial.uniforms.u_resolution.value.set(canvasWidth, canvasHeight);
        const geom = new THREE.PlaneGeometry(2, 2);
        this.tessellationMesh = new THREE.Mesh(geom, this.tessellationMaterial);
        this.tessellationMesh.renderOrder = 1.3;
        this.scene.add(this.tessellationMesh);
    }

    _removeTessellationMesh() {
        if (this.tessellationMesh) {
            this.scene.remove(this.tessellationMesh);
            this.tessellationMesh.geometry.dispose();
            this.tessellationMaterial.dispose();
            this.tessellationMesh = null;
            this.tessellationMaterial = null;
        }
    }

    dispose() {
        this._removeTessellationMesh();
        // Dispose all pooled geometries and materials
        for (const node of this.nodePool) {
            node.square.geometry.dispose();
            node.square.material.dispose();
            node.dot.geometry.dispose();
            node.dot.material.dispose();
        }
        for (const edge of this.edgePool) {
            edge.geometry.dispose();
            edge.material.dispose();
        }
        while (this.group.children.length) {
            this.group.remove(this.group.children[0]);
        }
        this.scene.remove(this.group);
    }
}
