import * as THREE from 'three';

const RING_SEGMENTS = 48;
const Z = 1.5;

function createReusableLine(color, opacity) {
    const positions = new Float32Array(6);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, linewidth: 1 });
    const line = new THREE.Line(geom, mat);
    line.visible = false;
    return line;
}

function createReusableRing(segments, color, opacity) {
    const positions = new Float32Array((segments + 1) * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const line = new THREE.Line(geom, mat);
    line.visible = false;
    return line;
}

// Pentagon is drawn as a single LineLoop-style line with 6 points (closed)
function createReusablePentagon(color, opacity) {
    const positions = new Float32Array(18); // 6 points × 3
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const line = new THREE.Line(geom, mat);
    line.visible = false;
    return line;
}

// Pentagram star: 6 points (0,2,4,1,3,0)
function createReusableStar(color, opacity) {
    const positions = new Float32Array(18); // 6 points × 3
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const line = new THREE.Line(geom, mat);
    line.visible = false;
    return line;
}

export class MandalaVisualizer {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.renderOrder = 2;
        this.scene.add(this.group);
        this.clock = new THREE.Clock();

        this.fingertips = [4, 8, 12, 16, 20];
        this.palmIndex = 9;

        // Pre-allocate all geometry for 2 hands
        this.hands = [];
        for (let h = 0; h < 2; h++) {
            const hand = {
                pentagon: createReusablePentagon(0x00ffff, 0.7),
                star: createReusableStar(0xff00ff, 0.6),
                rays: [],
                rings: [],
            };
            for (let i = 0; i < 5; i++) {
                hand.rays.push(createReusableLine(0xffaa00, 0.7));
            }
            for (let r = 0; r < 3; r++) {
                hand.rings.push(createReusableRing(RING_SEGMENTS, 0x00ffff, 0.35));
            }
            this.group.add(hand.pentagon);
            this.group.add(hand.star);
            hand.rays.forEach(l => this.group.add(l));
            hand.rings.forEach(l => this.group.add(l));
            this.hands.push(hand);
        }

        // Inter-hand: 5 bridge lines + 2 cross lines
        this.bridges = [];
        for (let i = 0; i < 5; i++) {
            const line = createReusableLine(0xff00ff, 0.6);
            this.bridges.push(line);
            this.group.add(line);
        }
        this.crosses = [];
        for (let i = 0; i < 2; i++) {
            const line = createReusableLine(0xffaa00, 0.5);
            this.crosses.push(line);
            this.group.add(line);
        }
    }

    update(handsData, canvasWidth, canvasHeight) {
        // Hide everything
        for (let h = 0; h < 2; h++) {
            const hand = this.hands[h];
            hand.pentagon.visible = false;
            hand.star.visible = false;
            for (let i = 0; i < 5; i++) hand.rays[i].visible = false;
            for (let i = 0; i < 3; i++) hand.rings[i].visible = false;
        }
        for (let i = 0; i < 5; i++) this.bridges[i].visible = false;
        for (let i = 0; i < 2; i++) this.crosses[i].visible = false;

        if (!handsData || handsData.length === 0) return;

        const time = this.clock.getElapsedTime();

        for (let h = 0; h < handsData.length && h < 2; h++) {
            const points3D = handsData[h];
            if (!points3D || points3D.length < 21) continue;

            const hand = this.hands[h];
            const tips = this.fingertips.map(idx => points3D[idx]);
            const palm = points3D[this.palmIndex];

            const area = this._polygonArea(tips);
            const areaFactor = Math.min(1, area / 40000);
            const hue = 0.5 - areaFactor * 0.3;
            const glowOpacity = 0.5 + areaFactor * 0.3;

            // 1. Pentagon
            const pentArr = hand.pentagon.geometry.attributes.position.array;
            for (let i = 0; i < 5; i++) {
                pentArr[i * 3] = tips[i].x;
                pentArr[i * 3 + 1] = tips[i].y;
                pentArr[i * 3 + 2] = Z;
            }
            pentArr[15] = tips[0].x;
            pentArr[16] = tips[0].y;
            pentArr[17] = Z;
            hand.pentagon.geometry.attributes.position.needsUpdate = true;
            hand.pentagon.material.color.setHSL(hue, 1.0, 0.5);
            hand.pentagon.material.opacity = glowOpacity;
            hand.pentagon.visible = true;

            // 2. Pentagram star (order: 0,2,4,1,3,0)
            const starOrder = [0, 2, 4, 1, 3, 0];
            const starArr = hand.star.geometry.attributes.position.array;
            for (let i = 0; i < 6; i++) {
                const idx = starOrder[i];
                starArr[i * 3] = tips[idx].x;
                starArr[i * 3 + 1] = tips[idx].y;
                starArr[i * 3 + 2] = Z;
            }
            hand.star.geometry.attributes.position.needsUpdate = true;
            hand.star.material.opacity = glowOpacity * 0.8;
            hand.star.visible = true;

            // 3. Palm-to-tip rays
            for (let i = 0; i < 5; i++) {
                const arr = hand.rays[i].geometry.attributes.position.array;
                arr[0] = palm.x; arr[1] = palm.y; arr[2] = Z;
                arr[3] = tips[i].x; arr[4] = tips[i].y; arr[5] = Z;
                hand.rays[i].geometry.attributes.position.needsUpdate = true;
                hand.rays[i].visible = true;
            }

            // 4. Concentric rings
            let avgDist = 0;
            for (let i = 0; i < 5; i++) {
                const dx = tips[i].x - palm.x;
                const dy = tips[i].y - palm.y;
                avgDist += Math.sqrt(dx * dx + dy * dy);
            }
            avgDist /= 5;

            const ringRadii = [avgDist * 0.4, avgDist * 0.7, avgDist * 1.0];
            for (let r = 0; r < 3; r++) {
                const radius = ringRadii[r];
                const arr = hand.rings[r].geometry.attributes.position.array;
                for (let s = 0; s <= RING_SEGMENTS; s++) {
                    const angle = (s / RING_SEGMENTS) * Math.PI * 2 + time * (0.5 + r * 0.3);
                    arr[s * 3] = palm.x + Math.cos(angle) * radius;
                    arr[s * 3 + 1] = palm.y + Math.sin(angle) * radius;
                    arr[s * 3 + 2] = Z;
                }
                hand.rings[r].geometry.attributes.position.needsUpdate = true;
                hand.rings[r].material.color.setHSL((hue + r * 0.15) % 1, 1.0, 0.5);
                hand.rings[r].visible = true;
            }
        }

        // 5 & 6. Inter-hand
        if (handsData.length >= 2 && handsData[0] && handsData[1] && handsData[0].length >= 21 && handsData[1].length >= 21) {
            const tips1 = this.fingertips.map(idx => handsData[0][idx]);
            const tips2 = this.fingertips.map(idx => handsData[1][idx]);

            for (let i = 0; i < 5; i++) {
                const arr = this.bridges[i].geometry.attributes.position.array;
                arr[0] = tips1[i].x; arr[1] = tips1[i].y; arr[2] = Z;
                arr[3] = tips2[i].x; arr[4] = tips2[i].y; arr[5] = Z;
                this.bridges[i].geometry.attributes.position.needsUpdate = true;
                this.bridges[i].visible = true;
            }

            const crossPairs = [[tips1[0], tips2[4]], [tips1[4], tips2[0]]];
            for (let c = 0; c < 2; c++) {
                const arr = this.crosses[c].geometry.attributes.position.array;
                arr[0] = crossPairs[c][0].x; arr[1] = crossPairs[c][0].y; arr[2] = Z;
                arr[3] = crossPairs[c][1].x; arr[4] = crossPairs[c][1].y; arr[5] = Z;
                this.crosses[c].geometry.attributes.position.needsUpdate = true;
                this.crosses[c].visible = true;
            }
        }
    }

    _polygonArea(points) {
        let area = 0;
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return Math.abs(area) / 2;
    }

    dispose() {
        // Dispose all pre-allocated geometry and materials
        for (const hand of this.hands) {
            hand.pentagon.geometry.dispose();
            hand.pentagon.material.dispose();
            hand.star.geometry.dispose();
            hand.star.material.dispose();
            for (const ray of hand.rays) {
                ray.geometry.dispose();
                ray.material.dispose();
            }
            for (const ring of hand.rings) {
                ring.geometry.dispose();
                ring.material.dispose();
            }
        }
        for (const bridge of this.bridges) {
            bridge.geometry.dispose();
            bridge.material.dispose();
        }
        for (const cross of this.crosses) {
            cross.geometry.dispose();
            cross.material.dispose();
        }
        this.scene.remove(this.group);
    }
}
