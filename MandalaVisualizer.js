import * as THREE from 'three';

export class MandalaVisualizer {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.renderOrder = 2;
        this.scene.add(this.group);
        this.clock = new THREE.Clock();

        // Fingertip landmark indices
        this.fingertips = [4, 8, 12, 16, 20];
        // Palm center
        this.palmIndex = 9;

        // Materials for different geometry layers
        this.pentagonMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.7, depthTest: false });
        this.starMat = new THREE.LineBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.6, depthTest: false });
        this.rayMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.7, depthTest: false });
        this.ringMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.4, depthTest: false });
        this.bridgeMat = new THREE.LineBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.6, depthTest: false });
        this.crossMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5, depthTest: false });
    }

    update(handsData, canvasWidth, canvasHeight) {
        // Clear previous frame
        while (this.group.children.length) {
            var child = this.group.children[0];
            this.group.remove(child);
            if (child.geometry) child.geometry.dispose();
        }

        if (!handsData || handsData.length === 0) return;

        var z = 1.5; // Above hand skeleton lines

        for (var h = 0; h < handsData.length; h++) {
            var points3D = handsData[h];
            if (!points3D || points3D.length < 21) continue;

            var tips = this.fingertips.map(function(idx) { return points3D[idx]; });
            var palm = points3D[this.palmIndex];

            // Calculate pentagon area for dynamic effects
            var area = this._polygonArea(tips);
            var areaFactor = Math.min(1, area / 40000); // normalize

            // Dynamic color based on area
            var hue = 0.5 - areaFactor * 0.3; // cool(cyan) -> warm(orange)
            var dynColor = new THREE.Color().setHSL(hue, 1.0, 0.5);
            var glowOpacity = 0.5 + areaFactor * 0.3;

            // 1. Fingertip pentagon
            var pentPoints = [];
            for (var i = 0; i < 5; i++) {
                pentPoints.push(new THREE.Vector3(tips[i].x, tips[i].y, z));
            }
            pentPoints.push(new THREE.Vector3(tips[0].x, tips[0].y, z)); // close
            var pentGeom = new THREE.BufferGeometry().setFromPoints(pentPoints);
            var pentMat = new THREE.LineBasicMaterial({ color: dynColor, transparent: true, opacity: glowOpacity, depthTest: false });
            this.group.add(new THREE.Line(pentGeom, pentMat));

            // 2. Pentagram star (each tip to two non-adjacent tips)
            var starOrder = [0, 2, 4, 1, 3, 0]; // classic pentagram
            var starPoints = starOrder.map(function(idx) {
                return new THREE.Vector3(tips[idx].x, tips[idx].y, z);
            });
            var starGeom = new THREE.BufferGeometry().setFromPoints(starPoints);
            var starMat = new THREE.LineBasicMaterial({ color: 0xff00ff, transparent: true, opacity: glowOpacity * 0.8, depthTest: false });
            this.group.add(new THREE.Line(starGeom, starMat));

            // 3. Palm-to-finger rays
            for (var i = 0; i < 5; i++) {
                var rayPoints = [
                    new THREE.Vector3(palm.x, palm.y, z),
                    new THREE.Vector3(tips[i].x, tips[i].y, z)
                ];
                var rayGeom = new THREE.BufferGeometry().setFromPoints(rayPoints);
                this.group.add(new THREE.Line(rayGeom, this.rayMat));
            }

            // 4. Concentric rings around palm
            var avgDist = 0;
            for (var i = 0; i < 5; i++) {
                var dx = tips[i].x - palm.x;
                var dy = tips[i].y - palm.y;
                avgDist += Math.sqrt(dx * dx + dy * dy);
            }
            avgDist /= 5;

            var ringRadii = [avgDist * 0.4, avgDist * 0.7, avgDist * 1.0];
            var ringSegments = 48;
            var time = this.clock.getElapsedTime();

            for (var r = 0; r < ringRadii.length; r++) {
                var radius = ringRadii[r];
                var ringPoints = [];
                for (var s = 0; s <= ringSegments; s++) {
                    var angle = (s / ringSegments) * Math.PI * 2 + time * (0.5 + r * 0.3);
                    ringPoints.push(new THREE.Vector3(
                        palm.x + Math.cos(angle) * radius,
                        palm.y + Math.sin(angle) * radius,
                        z
                    ));
                }
                var ringGeom = new THREE.BufferGeometry().setFromPoints(ringPoints);
                var ringColor = new THREE.Color().setHSL((hue + r * 0.15) % 1, 1.0, 0.5);
                var ringMat = new THREE.LineBasicMaterial({ color: ringColor, transparent: true, opacity: 0.35, depthTest: false });
                this.group.add(new THREE.Line(ringGeom, ringMat));
            }
        }

        // 5 & 6. Inter-hand bridge and cross-hand geometry
        if (handsData.length >= 2 && handsData[0] && handsData[1] && handsData[0].length >= 21 && handsData[1].length >= 21) {
            var h1 = handsData[0];
            var h2 = handsData[1];
            var tips1 = this.fingertips.map(function(idx) { return h1[idx]; });
            var tips2 = this.fingertips.map(function(idx) { return h2[idx]; });

            // Bridge: matching fingertips
            for (var i = 0; i < 5; i++) {
                var bridgePoints = [
                    new THREE.Vector3(tips1[i].x, tips1[i].y, z),
                    new THREE.Vector3(tips2[i].x, tips2[i].y, z)
                ];
                var bridgeGeom = new THREE.BufferGeometry().setFromPoints(bridgePoints);
                this.group.add(new THREE.Line(bridgeGeom, this.bridgeMat));
            }

            // Cross-hand X: thumb1->pinky2, pinky1->thumb2
            var crossLines = [
                [tips1[0], tips2[4]],
                [tips1[4], tips2[0]]
            ];
            for (var c = 0; c < crossLines.length; c++) {
                var crossPoints = [
                    new THREE.Vector3(crossLines[c][0].x, crossLines[c][0].y, z),
                    new THREE.Vector3(crossLines[c][1].x, crossLines[c][1].y, z)
                ];
                var crossGeom = new THREE.BufferGeometry().setFromPoints(crossPoints);
                this.group.add(new THREE.Line(crossGeom, this.crossMat));
            }
        }
    }

    _polygonArea(points) {
        var area = 0;
        var n = points.length;
        for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        return Math.abs(area) / 2;
    }

    dispose() {
        while (this.group.children.length) {
            var child = this.group.children[0];
            this.group.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        }
        this.scene.remove(this.group);
        // Dispose shared materials
        this.pentagonMat.dispose();
        this.starMat.dispose();
        this.rayMat.dispose();
        this.ringMat.dispose();
        this.bridgeMat.dispose();
        this.crossMat.dispose();
    }
}
