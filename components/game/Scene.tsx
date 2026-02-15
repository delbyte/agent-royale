'use client';

import { Environment } from '@react-three/drei';

export default function Scene() {
    return (
        <>
            {/* Ambient light for base illumination */}
            <ambientLight intensity={0.4} />

            {/* Main directional light (sun) */}
            <directionalLight
                position={[30, 50, 30]}
                intensity={1.2}
                castShadow
                shadow-mapSize={[2048, 2048]}
                shadow-camera-left={-60}
                shadow-camera-right={60}
                shadow-camera-top={60}
                shadow-camera-bottom={-60}
            />

            {/* Fill light */}
            <directionalLight position={[-20, 30, -20]} intensity={0.3} />

            {/* Sky */}
            <color attach="background" args={['#87CEEB']} />
            <fog attach="fog" args={['#87CEEB', 60, 100]} />
        </>
    );
}
