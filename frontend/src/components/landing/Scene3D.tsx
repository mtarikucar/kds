import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Cloud, Float, PerspectiveCamera, Environment, ContactShadows, ScrollControls, useScroll, RoundedBox } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

// --- Materials ---
const materials = {
    skin: new THREE.MeshStandardMaterial({ color: "#ffdbac", roughness: 0.3 }),
    white: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: "#333333", roughness: 0.4 }),
    red: new THREE.MeshStandardMaterial({ color: "#d65a5a", roughness: 0.3 }),
    metal: new THREE.MeshStandardMaterial({ color: "#aaaaaa", metalness: 0.7, roughness: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ color: "#8b5a2b", roughness: 0.6 }),
    orange: new THREE.MeshStandardMaterial({ color: "#ff9900", roughness: 0.3 }),
    floor: new THREE.MeshStandardMaterial({ color: "#e0e0e0", roughness: 0.5 }),
};

// --- Components ---

function SmoothChef({ position, scale = 1, rotation = [0, 0, 0] }: { position: [number, number, number], scale?: number, rotation?: [number, number, number] }) {
    const groupRef = useRef<THREE.Group>(null);

    useFrame((state) => {
        if (groupRef.current) {
            // Idle animation
            groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.05;
        }
    });

    return (
        <group ref={groupRef} position={position} scale={scale} rotation={rotation as any}>
            {/* Head Group */}
            <group position={[0, 1.5, 0]}>
                <mesh position={[0, 0, 0]} material={materials.skin}>
                    <sphereGeometry args={[0.45, 32, 32]} />
                </mesh>
                {/* Eyes */}
                <mesh position={[-0.15, 0.05, 0.4]} material={materials.dark}>
                    <sphereGeometry args={[0.05, 16, 16]} />
                </mesh>
                <mesh position={[0.15, 0.05, 0.4]} material={materials.dark}>
                    <sphereGeometry args={[0.05, 16, 16]} />
                </mesh>
                {/* Smile (Torus segment or just small spheres) */}
                <mesh position={[0, -0.15, 0.4]} rotation={[0, 0, 0]} material={materials.red}>
                    <torusGeometry args={[0.1, 0.02, 16, 32, Math.PI]} />
                </mesh>
                {/* Hat */}
                <group position={[0, 0.35, 0]}>
                    <mesh position={[0, 0, 0]} material={materials.white}>
                        <cylinderGeometry args={[0.46, 0.46, 0.3, 32]} />
                    </mesh>
                    <mesh position={[0, 0.3, 0]} material={materials.white}>
                        <sphereGeometry args={[0.5, 32, 32]} />
                    </mesh>
                </group>
            </group>

            {/* Body (Capsule-like) */}
            <mesh position={[0, 0.5, 0]} material={materials.white}>
                <capsuleGeometry args={[0.45, 0.9, 4, 16]} />
            </mesh>

            {/* Apron */}
            <group position={[0, 0.4, 0.46]}>
                <mesh material={materials.orange}>
                    <boxGeometry args={[0.6, 0.8, 0.05]} />
                    {/* Using box for apron panel, but could be curved plane */}
                </mesh>
            </group>

            {/* Scarf */}
            <mesh position={[0, 1.05, 0]} material={materials.red}>
                <torusGeometry args={[0.3, 0.08, 16, 32]} />
            </mesh>

            {/* Arms */}
            <group position={[-0.55, 0.8, 0]} rotation={[0, 0, 0.3]}>
                <mesh material={materials.white}>
                    <capsuleGeometry args={[0.12, 0.6, 4, 16]} />
                </mesh>
                <mesh position={[0, -0.4, 0]} material={materials.skin}>
                    <sphereGeometry args={[0.15, 16, 16]} />
                </mesh>
            </group>
            <group position={[0.55, 0.8, 0]} rotation={[0, 0, -0.3]}>
                <mesh material={materials.white}>
                    <capsuleGeometry args={[0.12, 0.6, 4, 16]} />
                </mesh>
                <mesh position={[0, -0.4, 0]} material={materials.skin}>
                    <sphereGeometry args={[0.15, 16, 16]} />
                </mesh>
                {/* Spatula */}
                <group position={[0, -0.5, 0.1]} rotation={[0.5, 0, 0]}>
                    <mesh position={[0, 0.3, 0]} material={materials.dark}>
                        <cylinderGeometry args={[0.03, 0.03, 0.6, 16]} />
                    </mesh>
                    <mesh position={[0, 0.6, 0]} material={materials.metal}>
                        <RoundedBox args={[0.3, 0.4, 0.02]} radius={0.05} smoothness={4} />
                    </mesh>
                </group>
            </group>

            {/* Legs */}
            <mesh position={[-0.25, -0.4, 0]} material={materials.dark}>
                <capsuleGeometry args={[0.15, 0.8, 4, 16]} />
            </mesh>
            <mesh position={[0.25, -0.4, 0]} material={materials.dark}>
                <capsuleGeometry args={[0.15, 0.8, 4, 16]} />
            </mesh>
        </group>
    );
}

function SmoothKitchen() {
    return (
        <group>
            {/* Floor */}
            <mesh position={[0, -2, -5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <planeGeometry args={[20, 20]} />
                <meshStandardMaterial color="#f0f0f0" />
            </mesh>

            {/* Back Counters - Smooth Edges */}
            <group position={[0, -1, -10]}>
                <RoundedBox args={[15, 2, 2]} radius={0.1} smoothness={4} material={materials.metal} position={[0, 0, 0]} />

                {/* Stovetops */}
                {[-3, -1, 1, 3].map((x, i) => (
                    <mesh key={i} position={[x, 1.02, 0]} material={materials.dark}>
                        <cylinderGeometry args={[0.5, 0.5, 0.05, 32]} />
                    </mesh>
                ))}
            </group>

            {/* Shelves */}
            <group position={[0, 3, -10]}>
                <RoundedBox args={[15, 0.2, 1]} radius={0.05} smoothness={4} material={materials.wood} />

                {/* Smooth Pots and Pans */}
                <mesh position={[-4, 0.4, 0]} material={materials.red}>
                    <cylinderGeometry args={[0.4, 0.35, 0.6, 32]} />
                </mesh>
                <mesh position={[-2, 0.4, 0]} material={materials.metal}>
                    <cylinderGeometry args={[0.5, 0.5, 0.4, 32]} />
                </mesh>
                <RoundedBox position={[2, 0.4, 0]} args={[0.6, 0.6, 0.6]} radius={0.1} smoothness={4} material={materials.orange} />
            </group>

            {/* Side Counters */}
            <group position={[-6, -1, -5]} rotation={[0, Math.PI / 2, 0]}>
                <RoundedBox args={[8, 2, 2]} radius={0.1} smoothness={4} material={materials.metal} />
            </group>
            <group position={[6, -1, -5]} rotation={[0, Math.PI / 2, 0]}>
                <RoundedBox args={[8, 2, 2]} radius={0.1} smoothness={4} material={materials.metal} />
            </group>
        </group>
    )
}

function SmoothCustomer({ position, color }: { position: [number, number, number], color: string }) {
    return (
        <group position={position}>
            {/* Head */}
            <mesh position={[0, 0.9, 0]} material={materials.skin}>
                <sphereGeometry args={[0.3, 32, 32]} />
            </mesh>
            {/* Body */}
            <mesh position={[0, 0.2, 0]}>
                <capsuleGeometry args={[0.35, 0.8, 4, 16]} />
                <meshStandardMaterial color={color} roughness={0.3} />
            </mesh>
        </group>
    )
}

function SmoothDiningArea() {
    return (
        <group position={[0, -20, 0]}>
            {/* Floor */}
            <mesh position={[0, -2, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <planeGeometry args={[30, 30]} />
                <meshStandardMaterial color="#d0d0d0" />
            </mesh>

            {/* Tables */}
            {[[-5, 0, -5], [5, 0, -5], [-5, 0, 5], [5, 0, 5]].map((pos, i) => (
                <group key={i} position={pos as any}>
                    {/* Table Top */}
                    <mesh position={[0, 0, 0]} material={materials.wood}>
                        <cylinderGeometry args={[1.5, 1.5, 0.1, 64]} />
                    </mesh>
                    {/* Table Leg */}
                    <mesh position={[0, -1, 0]} material={materials.metal}>
                        <cylinderGeometry args={[0.2, 0.2, 2, 32]} />
                    </mesh>

                    {/* Customers */}
                    <SmoothCustomer position={[-1, -0.5, 0]} color="#4a90e2" />
                    <SmoothCustomer position={[1, -0.5, 0]} color="#50e3c2" />
                    <SmoothCustomer position={[0, -0.5, 1]} color="#f5a623" />
                </group>
            ))}
        </group>
    )
}

function CameraController() {
    const scroll = useScroll();
    const { camera } = useThree();

    useFrame(() => {
        const r1 = scroll.range(0, 1 / 3);

        const kitchenClosePos = new THREE.Vector3(0, 0, 6);
        const kitchenFarPos = new THREE.Vector3(0, 2, 12);
        const diningPos = new THREE.Vector3(0, -15, 15);

        const currentPos = new THREE.Vector3();

        if (scroll.offset < 0.33) {
            currentPos.lerpVectors(kitchenClosePos, kitchenFarPos, r1);
            camera.lookAt(0, 0, 0);
        } else {
            currentPos.lerpVectors(kitchenFarPos, diningPos, (scroll.offset - 0.33) * 1.5);
            const lookAtTarget = new THREE.Vector3().lerpVectors(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -20, 0), (scroll.offset - 0.33) * 1.5);
            camera.lookAt(lookAtTarget);
        }

        camera.position.copy(currentPos);
    });
    return null;
}

export const Scene3D = () => {
    return (
        <div className="absolute inset-0 z-0 pointer-events-none">
            <Canvas gl={{ antialias: true, alpha: true }} shadows>
                <PerspectiveCamera makeDefault position={[0, 0, 6]} fov={50} />
                <ambientLight intensity={0.6} />
                <pointLight position={[10, 10, 10]} intensity={0.8} castShadow />
                <Environment preset="city" />

                <ScrollControls pages={3} damping={0.2}>
                    <CameraController />

                    {/* Kitchen Scene */}
                    <group>
                        <SmoothKitchen />
                        <SmoothChef position={[1.5, -1, -2]} scale={1.5} rotation={[0, -0.3, 0]} />

                        {/* Extra Chefs/Staff */}
                        <SmoothChef position={[-2, -1, -4]} scale={1.2} rotation={[0, 0.5, 0]} />
                        <SmoothChef position={[4, -1, -6]} scale={1.2} rotation={[0, -0.5, 0]} />

                        {/* Clouds */}
                        <Cloud position={[-4, 3, -5]} opacity={0.3} speed={0.2} width={10} depth={1.5} segments={10} color="#fff" />
                    </group>

                    {/* Dining Scene */}
                    <SmoothDiningArea />

                </ScrollControls>
            </Canvas>
        </div>
    );
};
