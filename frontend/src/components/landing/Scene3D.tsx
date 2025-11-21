import { Canvas, useFrame } from '@react-three/fiber';
import { Cloud, Float, PerspectiveCamera, Environment, ContactShadows } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

function VoxelChef({ position, scale = 1 }: { position: [number, number, number], scale?: number }) {
    const groupRef = useRef<THREE.Group>(null);

    useFrame((state) => {
        if (groupRef.current) {
            // Idle animation: bobbing and slight rotation
            groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.1;
            groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1 - 0.2; // Slight look around
        }
    });

    const skinColor = "#ffdbac";
    const white = "#ffffff";
    const dark = "#333333";

    return (
        <group ref={groupRef} position={position} scale={scale}>
            {/* Head Group */}
            <group position={[0, 1.4, 0]}>
                {/* Face */}
                <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[0.8, 0.8, 0.8]} />
                    <meshStandardMaterial color={skinColor} />
                </mesh>
                {/* Eyes */}
                <mesh position={[-0.2, 0.1, 0.41]}>
                    <boxGeometry args={[0.1, 0.1, 0.05]} />
                    <meshStandardMaterial color={dark} />
                </mesh>
                <mesh position={[0.2, 0.1, 0.41]}>
                    <boxGeometry args={[0.1, 0.1, 0.05]} />
                    <meshStandardMaterial color={dark} />
                </mesh>
                {/* Smile */}
                <mesh position={[0, -0.2, 0.41]}>
                    <boxGeometry args={[0.3, 0.05, 0.05]} />
                    <meshStandardMaterial color="#d65a5a" />
                </mesh>
                <mesh position={[-0.15, -0.15, 0.41]}>
                    <boxGeometry args={[0.05, 0.05, 0.05]} />
                    <meshStandardMaterial color="#d65a5a" />
                </mesh>
                <mesh position={[0.15, -0.15, 0.41]}>
                    <boxGeometry args={[0.05, 0.05, 0.05]} />
                    <meshStandardMaterial color="#d65a5a" />
                </mesh>

                {/* Chef Hat */}
                <group position={[0, 0.5, 0]}>
                    {/* Hat Base */}
                    <mesh position={[0, 0, 0]}>
                        <cylinderGeometry args={[0.45, 0.45, 0.2, 32]} />
                        <meshStandardMaterial color={white} />
                    </mesh>
                    {/* Hat Top (Puffy part) */}
                    <mesh position={[0, 0.3, 0]}>
                        <sphereGeometry args={[0.5, 32, 32]} />
                        <meshStandardMaterial color={white} />
                    </mesh>
                </group>
            </group>

            {/* Body */}
            <mesh position={[0, 0.4, 0]}>
                <boxGeometry args={[0.9, 1.2, 0.5]} />
                <meshStandardMaterial color={white} />
            </mesh>
            {/* Buttons */}
            <mesh position={[0, 0.6, 0.26]}>
                <cylinderGeometry args={[0.05, 0.05, 0.05, 8]} rotation={[Math.PI / 2, 0, 0]} />
                <meshStandardMaterial color={dark} />
            </mesh>
            <mesh position={[0, 0.3, 0.26]}>
                <cylinderGeometry args={[0.05, 0.05, 0.05, 8]} rotation={[Math.PI / 2, 0, 0]} />
                <meshStandardMaterial color={dark} />
            </mesh>

            {/* Arms */}
            <mesh position={[-0.6, 0.6, 0]}>
                <boxGeometry args={[0.3, 0.8, 0.3]} />
                <meshStandardMaterial color={white} />
            </mesh>
            <mesh position={[0.6, 0.6, 0]}>
                <boxGeometry args={[0.3, 0.8, 0.3]} />
                <meshStandardMaterial color={white} />
            </mesh>
            {/* Hands */}
            <mesh position={[-0.6, 0.1, 0]}>
                <sphereGeometry args={[0.18]} />
                <meshStandardMaterial color={skinColor} />
            </mesh>
            <mesh position={[0.6, 0.1, 0]}>
                <sphereGeometry args={[0.18]} />
                <meshStandardMaterial color={skinColor} />
            </mesh>

            {/* Legs */}
            <mesh position={[-0.25, -0.5, 0]}>
                <boxGeometry args={[0.35, 0.8, 0.35]} />
                <meshStandardMaterial color={dark} />
            </mesh>
            <mesh position={[0.25, -0.5, 0]}>
                <boxGeometry args={[0.35, 0.8, 0.35]} />
                <meshStandardMaterial color={dark} />
            </mesh>
        </group>
    );
}

function CookingPan({ position }: { position: [number, number, number] }) {
    const groupRef = useRef<THREE.Group>(null);

    useFrame((state) => {
        if (groupRef.current) {
            // Sizzling motion
            groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 10) * 0.02;
        }
    });

    return (
        <group ref={groupRef} position={position}>
            {/* Pan */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[1, 0.8, 0.2, 32]} />
                <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Handle */}
            <mesh position={[1.2, 0.1, 0]} rotation={[0, 0, -0.2]}>
                <boxGeometry args={[1.5, 0.15, 0.3]} />
                <meshStandardMaterial color="#111" />
            </mesh>
            {/* Food particles (simple cubes for voxel style) */}
            <group position={[0, 0.3, 0]}>
                {Array.from({ length: 5 }).map((_, i) => (
                    <mesh key={i} position={[Math.random() * 0.5 - 0.25, 0, Math.random() * 0.5 - 0.25]}>
                        <boxGeometry args={[0.2, 0.2, 0.2]} />
                        <meshStandardMaterial color={i % 2 === 0 ? "#ff9900" : "#ffcc00"} />
                    </mesh>
                ))}
            </group>
            {/* Steam */}
            <Cloud position={[0, 1, 0]} opacity={0.3} speed={0.4} width={1} depth={0.5} segments={5} color="#ffffff" />
        </group>
    );
}

export const Scene3D = () => {
    return (
        <div className="absolute inset-0 z-0 pointer-events-none">
            <Canvas gl={{ antialias: true, alpha: true }}>
                <PerspectiveCamera makeDefault position={[0, 0, 10]} fov={50} />
                <ambientLight intensity={0.8} />
                <pointLight position={[10, 10, 10]} intensity={1} />
                <Environment preset="sunset" />

                {/* Fluid Clouds Background */}
                <Cloud position={[-4, 2, -5]} opacity={0.5} speed={0.2} width={10} depth={1.5} segments={20} color="#fff0e6" />
                <Cloud position={[4, -2, -5]} opacity={0.5} speed={0.2} width={10} depth={1.5} segments={20} color="#fff0e6" />

                {/* 3D Voxel Chef - Positioned in corner */}
                <VoxelChef position={[5, -2, 0]} scale={1.8} />

                {/* Cooking Animation */}
                <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.5}>
                    <CookingPan position={[-3.5, -1, 0]} />
                </Float>

                <ContactShadows position={[0, -4, 0]} opacity={0.4} scale={20} blur={2} far={4.5} />
            </Canvas>
        </div>
    );
};
