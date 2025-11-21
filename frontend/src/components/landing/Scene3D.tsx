import { Canvas, useFrame } from '@react-three/fiber';
import { Cloud, Float, PerspectiveCamera, Environment, ContactShadows } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

function FloatingVoxel({ position, textureUrl, scale = 1, rotationSpeed = 0.5 }: { position: [number, number, number], textureUrl: string, scale?: number, rotationSpeed?: number }) {
    const meshRef = useRef<THREE.Mesh>(null);
    const texture = useMemo(() => new THREE.TextureLoader().load(textureUrl), [textureUrl]);

    // Fix texture encoding/color space if needed
    texture.colorSpace = THREE.SRGBColorSpace;

    useFrame((state) => {
        if (meshRef.current) {
            meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime * rotationSpeed) * 0.2;
            meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime) * 0.1;
        }
    });

    return (
        <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
            <mesh ref={meshRef} position={position} scale={scale}>
                <planeGeometry args={[3, 3]} />
                <meshStandardMaterial map={texture} transparent alphaTest={0.5} />
            </mesh>
        </Float>
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

                {/* Voxel Chef */}
                <FloatingVoxel position={[3, 0, 0]} textureUrl="/voxel-chef.png" scale={1.5} />

                {/* Voxel Logo */}
                <FloatingVoxel position={[-3, 1, -2]} textureUrl="/voxel-logo.png" scale={1.2} rotationSpeed={0.3} />

                {/* Cooking Animation */}
                <Float speed={1.5} rotationIntensity={0.5} floatIntensity={0.5}>
                    <CookingPan position={[-2.5, -1.5, 0]} />
                </Float>

                <ContactShadows position={[0, -4, 0]} opacity={0.4} scale={20} blur={2} far={4.5} />
            </Canvas>
        </div>
    );
};
