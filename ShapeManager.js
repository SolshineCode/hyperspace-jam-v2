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
        this.shapeFormedTime = 0; // when current closed shape first formed
        this.lastShapeType = 'none';
        this.tessellationActive = false;

        this.PINCH_THRESHOLD = 40; // pixels screen space
        this.SMOOTH_FACTOR = 0.3;
        this.FADE_DURATION = 200; // ms
    }

    update(handsData, canvasWidth, canvasHeight) {
        var now = performance.now();

        // --- Clear previous frame geometry ---
        while (this.group.children.length) {
            var child = this.group.children[0];
            this.group.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }

        if (!handsData) handsData = [];

        // --- Detect pinches and compute raw anchors ---
        var rawAnchors = [];
        for (var h = 0; h < handsData.length; h++) {
            var points3D = handsData[h];
            if (!points3D || points3D.length < 21) continue;

            var thumb = points3D[4];
            var index = points3D[8];
            var dx = thumb.x - index.x;
            var dy = thumb.y - index.y;
            var dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < this.PINCH_THRESHOLD) {
                // Compute average z across all landmarks for depth
                var avgZ = 0;
                for (var l = 0; l < 21; l++) {
                    avgZ += points3D[l].z;
                }
                avgZ /= 21;

                rawAnchors.push({
                    position: new THREE.Vector3(
                        (thumb.x + index.x) / 2,
                        (thumb.y + index.y) / 2,
                        0
                    ),
                    handIndex: h,
                    avgZ: avgZ
                });
            }
        }

        // --- Match raw anchors to existing anchors by hand index ---
        var matchedIndices = new Set();
        var newAnchors = [];

        for (var r = 0; r < rawAnchors.length; r++) {
            var raw = rawAnchors[r];
            var found = false;

            for (var a = 0; a < this.anchors.length; a++) {
                if (matchedIndices.has(a)) continue;
                if (this.anchors[a].handIndex === raw.handIndex) {
                    // Update existing anchor with smoothing
                    var anchor = this.anchors[a];
                    anchor.smoothed.x += (raw.position.x - anchor.smoothed.x) * this.SMOOTH_FACTOR;
                    anchor.smoothed.y += (raw.position.y - anchor.smoothed.y) * this.SMOOTH_FACTOR;
                    anchor.depthScale = this._computeDepthScale(raw.avgZ);
                    anchor.avgZ = raw.avgZ;
                    newAnchors.push(anchor);
                    matchedIndices.add(a);
                    found = true;
                    break;
                }
            }

            if (!found) {
                // New anchor — birth it
                var smoothed = raw.position.clone();
                newAnchors.push({
                    smoothed: smoothed,
                    handIndex: raw.handIndex,
                    birthTime: now,
                    depthScale: this._computeDepthScale(raw.avgZ),
                    avgZ: raw.avgZ
                });
            }
        }

        // Anchors that disappeared — move to fading
        for (var a = 0; a < this.anchors.length; a++) {
            if (!matchedIndices.has(a)) {
                var dying = this.anchors[a];
                dying.fadeStartTime = now;
                this.fadingAnchors.push(dying);
            }
        }

        this.anchors = newAnchors;

        // --- Update fading anchors, remove expired ---
        this.fadingAnchors = this.fadingAnchors.filter(function(fa) {
            return (now - fa.fadeStartTime) < 200;
        });

        // --- Determine shape type ---
        var activeCount = this.anchors.length;
        var shapeType = 'none';
        if (activeCount === 2) shapeType = 'line';
        else if (activeCount === 3) shapeType = 'triangle';
        else if (activeCount >= 4) shapeType = 'quad';

        // --- Render active anchor nodes ---
        for (var i = 0; i < this.anchors.length; i++) {
            var anc = this.anchors[i];
            var age = now - anc.birthTime;
            var fadeIn = Math.min(1, age / this.FADE_DURATION);
            this._drawNode(anc.smoothed, anc.depthScale, fadeIn);
        }

        // --- Render fading anchor nodes ---
        for (var i = 0; i < this.fadingAnchors.length; i++) {
            var fa = this.fadingAnchors[i];
            var fadeOut = 1 - Math.min(1, (now - fa.fadeStartTime) / this.FADE_DURATION);
            this._drawNode(fa.smoothed, fa.depthScale, fadeOut);
        }

        // --- Render edges ---
        if (shapeType !== 'none') {
            this._drawEdges(shapeType, now);
        }

        // --- Internal tessellation for closed shapes ---
        if (shapeType === 'triangle' || shapeType === 'quad') {
            // Track when this shape type first formed
            if (shapeType !== this.lastShapeType) {
                this.shapeFormedTime = now;
                this.lastShapeType = shapeType;
                this.tessellationActive = false;
            }

            // Activate tessellation after 200ms hold
            if (!this.tessellationActive && (now - this.shapeFormedTime) > 200) {
                this.tessellationActive = true;
                this._createTessellationMesh(canvasWidth, canvasHeight);
            }

            // Update tessellation uniforms each frame
            if (this.tessellationActive && this.tessellationMaterial) {
                this.tessellationMaterial.uniforms.u_time.value = now * 0.001;
                this.tessellationMaterial.uniforms.u_vertexCount.value = (shapeType === 'triangle') ? 3 : 4;
                this.tessellationMaterial.uniforms.u_resolution.value.set(canvasWidth, canvasHeight);

                // Pass anchor positions as normalized [-1, 1] coordinates
                for (var v = 0; v < 4; v++) {
                    if (v < this.anchors.length) {
                        this.tessellationMaterial.uniforms.u_vertices.value[v].set(
                            this.anchors[v].smoothed.x / (canvasWidth / 2),
                            this.anchors[v].smoothed.y / (canvasHeight / 2)
                        );
                    }
                }
            }
        } else {
            // Shape dissolved — remove tessellation
            if (this.tessellationActive) {
                this._removeTessellationMesh();
                this.tessellationActive = false;
            }
            this.lastShapeType = shapeType;
        }
    }

    _computeDepthScale(avgZ) {
        // Map z from [-0.15, 0] to [2.5, 0.6]
        var t = Math.max(0, Math.min(1, (avgZ - (-0.15)) / (0 - (-0.15))));
        return 2.5 + t * (0.6 - 2.5); // lerp from 2.5 to 0.6
    }

    _drawNode(position, depthScale, opacity) {
        var z = 1.8;
        var baseOuter = 6 * depthScale;
        var baseInner = 8 * depthScale;
        var dotRadius = 2 * depthScale;

        // Outer ring (square-ish with 4 segments)
        var ringGeom = new THREE.RingGeometry(baseOuter, baseInner, 4);
        var ringMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: opacity,
            depthTest: false,
            side: THREE.DoubleSide
        });
        var ringMesh = new THREE.Mesh(ringGeom, ringMat);
        ringMesh.position.set(position.x, position.y, z);
        this.group.add(ringMesh);

        // Inner dot
        var dotGeom = new THREE.CircleGeometry(dotRadius, 8);
        var dotMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: opacity,
            depthTest: false,
            side: THREE.DoubleSide
        });
        var dotMesh = new THREE.Mesh(dotGeom, dotMat);
        dotMesh.position.set(position.x, position.y, z);
        this.group.add(dotMesh);
    }

    _drawEdges(shapeType, now) {
        var z = 1.7;
        var anchors = this.anchors;

        // Compute min opacity from birth fades
        var minOpacity = 1;
        for (var i = 0; i < anchors.length; i++) {
            var age = now - anchors[i].birthTime;
            var fade = Math.min(1, age / this.FADE_DURATION);
            if (fade < minOpacity) minOpacity = fade;
        }

        // Average depth scale for edge opacity
        var avgDepth = 0;
        for (var i = 0; i < anchors.length; i++) {
            avgDepth += anchors[i].depthScale;
        }
        avgDepth /= anchors.length;
        var edgeOpacity = minOpacity * Math.min(1, avgDepth / 2.5);

        var lineMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: edgeOpacity,
            depthTest: false,
            linewidth: 2
        });

        if (shapeType === 'line') {
            // Draw two parallel lines offset ±3 pixels perpendicular
            var a = anchors[0].smoothed;
            var b = anchors[1].smoothed;
            var dx = b.x - a.x;
            var dy = b.y - a.y;
            var len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.001) return;
            var nx = -dy / len * 3;
            var ny = dx / len * 3;

            for (var side = -1; side <= 1; side += 2) {
                var points = [
                    new THREE.Vector3(a.x + nx * side, a.y + ny * side, z),
                    new THREE.Vector3(b.x + nx * side, b.y + ny * side, z)
                ];
                var geom = new THREE.BufferGeometry().setFromPoints(points);
                this.group.add(new THREE.Line(geom, lineMat));
            }
        } else if (shapeType === 'triangle') {
            // Connect 0→1→2→0
            var points = [];
            for (var i = 0; i < 3; i++) {
                points.push(new THREE.Vector3(anchors[i].smoothed.x, anchors[i].smoothed.y, z));
            }
            points.push(new THREE.Vector3(anchors[0].smoothed.x, anchors[0].smoothed.y, z));
            var geom = new THREE.BufferGeometry().setFromPoints(points);
            this.group.add(new THREE.Line(geom, lineMat));
        } else if (shapeType === 'quad') {
            // Connect 0→1→2→3→0
            var points = [];
            for (var i = 0; i < 4; i++) {
                points.push(new THREE.Vector3(anchors[i].smoothed.x, anchors[i].smoothed.y, z));
            }
            points.push(new THREE.Vector3(anchors[0].smoothed.x, anchors[0].smoothed.y, z));
            var geom = new THREE.BufferGeometry().setFromPoints(points);
            this.group.add(new THREE.Line(geom, lineMat));
        }
    }

    getShapeState() {
        var count = this.anchors.length;
        var type = 'none';
        if (count === 2) type = 'line';
        else if (count === 3) type = 'triangle';
        else if (count >= 4) type = 'quad';

        var anchorPositions = this.anchors.map(function(a) {
            return a.smoothed.clone();
        });

        return { type: type, anchors: anchorPositions };
    }

    getAnchors() {
        return this.anchors.map(function(a) {
            return a.smoothed.clone();
        });
    }

    getAverageDepth() {
        if (this.anchors.length === 0) return 0;
        var sum = 0;
        for (var i = 0; i < this.anchors.length; i++) {
            sum += this.anchors[i].avgZ;
        }
        return sum / this.anchors.length;
    }

    getShapeArea() {
        if (this.anchors.length < 3) return 0;
        var points = this.anchors.map(function(a) { return a.smoothed; });
        var area = 0;
        var n = points.length;
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        area = Math.abs(area) / 2;
        // Normalize: assume max area ~200000 px^2
        return Math.min(1, area / 200000);
    }

    _createTessellationMesh(canvasWidth, canvasHeight) {
        this._removeTessellationMesh(); // clean up any existing
        this.tessellationMaterial = createTessellationMaterial();
        this.tessellationMaterial.uniforms.u_resolution.value.set(canvasWidth, canvasHeight);
        var geom = new THREE.PlaneGeometry(2, 2);
        this.tessellationMesh = new THREE.Mesh(geom, this.tessellationMaterial);
        this.tessellationMesh.renderOrder = 1.3; // above skeleton, below mandala
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
        while (this.group.children.length) {
            var child = this.group.children[0];
            this.group.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
        this.scene.remove(this.group);
    }
}
