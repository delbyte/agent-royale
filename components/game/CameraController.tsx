'use client';

import { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls, Html } from '@react-three/drei';
import * as THREE from 'three';

interface Props {
    followId: string | null;
    players: any[];
}

export default function CameraController({ followId, players }: Props) {
    const { camera } = useThree();
    const controlsRef = useRef<any>(null);
    const moveForward = useRef(false);
    const moveBackward = useRef(false);
    const moveLeft = useRef(false);
    const moveRight = useRef(false);
    const moveUp = useRef(false);
    const moveDown = useRef(false);

    const velocity = useRef(new THREE.Vector3());
    const direction = useRef(new THREE.Vector3());

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    moveForward.current = true;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    moveLeft.current = true;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    moveBackward.current = true;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    moveRight.current = true;
                    break;
                case 'Space':
                    moveUp.current = true;
                    break;
                case 'ShiftLeft':
                    moveDown.current = true;
                    break;
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    moveForward.current = false;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    moveLeft.current = false;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    moveBackward.current = false;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    moveRight.current = false;
                    break;
                case 'Space':
                    moveUp.current = false;
                    break;
                case 'ShiftLeft':
                    moveDown.current = false;
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    useFrame((state, delta) => {
        if (controlsRef.current?.isLocked) {
            velocity.current.x -= velocity.current.x * 10.0 * delta;
            velocity.current.z -= velocity.current.z * 10.0 * delta;
            velocity.current.y -= velocity.current.y * 10.0 * delta;

            direction.current.z = Number(moveForward.current) - Number(moveBackward.current);
            direction.current.x = Number(moveRight.current) - Number(moveLeft.current);
            direction.current.y = Number(moveUp.current) - Number(moveDown.current);

            direction.current.normalize();

            if (moveForward.current || moveBackward.current) velocity.current.z -= direction.current.z * 100.0 * delta;
            if (moveLeft.current || moveRight.current) velocity.current.x -= direction.current.x * 100.0 * delta;
            if (moveUp.current || moveDown.current) velocity.current.y += direction.current.y * 100.0 * delta;

            controlsRef.current.moveRight(-velocity.current.x * delta);
            controlsRef.current.moveForward(-velocity.current.z * delta);
            camera.position.y += velocity.current.y * delta;
        }
    });

    const [hasStarted, setHasStarted] = useState(false);
    useEffect(() => {
        const handleLock = () => setHasStarted(true);
        if (controlsRef.current) {
            controlsRef.current.addEventListener('lock', handleLock);
        }
        return () => {
            if (controlsRef.current) {
                controlsRef.current.removeEventListener('lock', handleLock);
            }
        };
    }, []);

    if (hasStarted) {
        return <PointerLockControls ref={controlsRef} />;
    }

    return (
        <>
            <PointerLockControls ref={controlsRef} />
            <Html center wrapperClass="instruction-overlay" style={{ pointerEvents: 'none' }}>
                <div style={{
                    color: 'white',
                    display: controlsRef.current?.isLocked ? 'none' : 'block',
                    textAlign: 'center',
                    background: 'rgba(0,0,0,0.5)',
                    padding: '20px',
                    borderRadius: '10px',
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    fontFamily: 'sans-serif'
                }}>
                    <div style={{ margin: '5px 0' }}>Click screen to start</div>
                    <div style={{ margin: '5px 0' }}>WASD to move, Mouse to look</div>
                    <div style={{ margin: '5px 0' }}>Space/Shift to fly Up/Down</div>
                </div>
            </Html>
        </>
    );
}
