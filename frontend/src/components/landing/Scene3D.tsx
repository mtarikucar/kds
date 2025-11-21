import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Cloud, Float, PerspectiveCamera, Environment, ContactShadows, ScrollControls, useScroll } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

// --- Materials ---
const materials = {
    skin: new THREE.MeshStandardMaterial({ color: "#ffdbac" }),
    white: new THREE.MeshStandardMaterial({ color: "#ffffff" }),
    dark: new THREE.MeshStandardMaterial({ color: "#333333" }),
    red: new THREE.MeshStandardMaterial({ color: "#d65a5a" }),
    metal: new THREE.MeshStandardMaterial({ color: "#888888", metalness: 0.8, roughness: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ color: "#8b5a2b" }),
    orange: new THREE.MeshStandardMaterial({ color: "#ff9900" }),
    floor: new THREE.MeshStandardMaterial({ color: "#e0e0e0" }),
};

// --- Components ---

function VoxelChef({ position, scale = 1, rotation = [0, 0, 0] }: { position: [number, number, number], scale?: number, rotation?: [number, number, number] }) {
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
            <group position={[0, 1.4, 0]}>
                <mesh position={[0, 0, 0]} material={materials.skin}><boxGeometry args={[0.8, 0.8, 0.8]} /></mesh>
                {/* Eyes */}
                <mesh position={[-0.2, 0.1, 0.41]} material={materials.dark}><boxGeometry args={[0.1, 0.1, 0.05]} /></mesh>
                <mesh position={[0.2, 0.1, 0.41]} material={materials.dark}><boxGeometry args={[0.1, 0.1, 0.05]} /></mesh>
                {/* Smile */}
                <mesh position={[0, -0.2, 0.41]} material={materials.red}><boxGeometry args={[0.3, 0.05, 0.05]} /></mesh>
                {/* Hat */}
                <group position={[0, 0.5, 0]}>
                    <mesh position={[0, 0, 0]} material={materials.white}><cylinderGeometry args={[0.45, 0.45, 0.2, 32]} /></mesh>
                    <mesh position={[0, 0.3, 0]} material={materials.white}><sphereGeometry args={[0.5, 32, 32]} /></mesh>
                </group>
            </group>

            {/* Body */}
            <mesh position={[0, 0.4, 0]} material={materials.white}><boxGeometry args={[0.9, 1.2, 0.5]} /></mesh>
            {/* Apron */}
            <mesh position={[0, 0.3, 0.26]} material={materials.orange}><boxGeometry args={[0.7, 0.8, 0.05]} /></mesh>
            {/* Scarf */}
            <mesh position={[0, 0.9, 0.26]} material={materials.red}><boxGeometry args={[0.5, 0.2, 0.1]} /></mesh>

            {/* Arms */}
            <group position={[-0.6, 0.6, 0]} rotation={[0, 0, 0.2]}>
                <mesh material={materials.white}><boxGeometry args={[0.3, 0.8, 0.3]} /></mesh>
                <mesh position={[0, -0.5, 0]} material={materials.skin}><sphereGeometry args={[0.18]} /></mesh>
            </group>
            <group position={[0.6, 0.6, 0]} rotation={[0, 0, -0.2]}>
                <mesh material={materials.white}><boxGeometry args={[0.3, 0.8, 0.3]} /></mesh>
                <mesh position={[0, -0.5, 0]} material={materials.skin}><sphereGeometry args={[0.18]} /></mesh>
                {/* Spatula */}
                <group position={[0, -0.6, 0.2]} rotation={[0.5, 0, 0]}>
                    <mesh position={[0, 0.3, 0]} material={materials.dark}><cylinderGeometry args={[0.05, 0.05, 0.6]} /></mesh>
                    <mesh position={[0, 0.6, 0]} material={materials.metal}><boxGeometry args={[0.3, 0.4, 0.05]} /></mesh>
                </group>
            </group>

            {/* Legs */}
            <mesh position={[-0.25, -0.5, 0]} material={materials.dark}><boxGeometry args={[0.35, 0.8, 0.35]} /></mesh>
            <mesh position={[0.25, -0.5, 0]} material={materials.dark}><boxGeometry args={[0.35, 0.8, 0.35]} /></mesh>
        </group>
    );
}

function KitchenEnvironment() {
    return (
        <group>
            {/* Floor */}
            <mesh position={[0, -2, -5]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <planeGeometry args={[20, 20]} />
                <meshStandardMaterial color="#f0f0f0" />
            </mesh>

            {/* Back Counters */}
            <group position={[0, -1, -10]}>
                <mesh position={[0, 0, 0]} material={materials.metal}><boxGeometry args={[15, 2, 2]} /></mesh>
                {/* Stovetops */}
                <mesh position={[-3, 1.05, 0]} material={materials.dark}><cylinderGeometry args={[0.5, 0.5, 0.1]} /></mesh>
                <mesh position={[-1, 1.05, 0]} material={materials.dark}><cylinderGeometry args={[0.5, 0.5, 0.1]} /></mesh>
                <mesh position={[1, 1.05, 0]} material={materials.dark}><cylinderGeometry args={[0.5, 0.5, 0.1]} /></mesh>
                <mesh position={[3, 1.05, 0]} material={materials.dark}><cylinderGeometry args={[0.5, 0.5, 0.1]} /></mesh>
            </group>

            {/* Shelves */}
            <group position={[0, 3, -10]}>
                <mesh material={materials.wood}><boxGeometry args={[15, 0.2, 1]} /></mesh>
                {/* Pots and Pans */}
                <mesh position={[-4, 0.5, 0]} material={materials.red}><cylinderGeometry args={[0.4, 0.3, 0.6]} /></mesh>
                <mesh position={[-2, 0.5, 0]} material={materials.metal}><cylinderGeometry args={[0.5, 0.5, 0.4]} /></mesh>
                <mesh position={[2, 0.5, 0]} material={materials.orange}><boxGeometry args={[0.6, 0.6, 0.6]} /></mesh>
            </group>

            {/* Side Counters */}
            <mesh position={[-6, -1, -5]} rotation={[0, Math.PI / 2, 0]} material={materials.metal}><boxGeometry args={[8, 2, 2]} /></mesh>
            <mesh position={[6, -1, -5]} rotation={[0, Math.PI / 2, 0]} material={materials.metal}><boxGeometry args={[8, 2, 2]} /></mesh>
        </group>
    )
}

function Customer({ position, color }: { position: [number, number, number], color: string }) {
    return (
        <group position={position}>
            <mesh position={[0, 0.8, 0]} material={materials.skin}><boxGeometry args={[0.5, 0.5, 0.5]} /></mesh>
            <mesh position={[0, 0, 0]}>
                <boxGeometry args={[0.6, 1, 0.4]} />
                <meshStandardMaterial color={color} />
            </mesh>
        </group>
    )
}

function DiningArea() {
    return (
        <group position={[0, -20, 0]}> {/* Located below the kitchen for scroll transition */}
            {/* Floor */}
            <mesh position={[0, -2, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <planeGeometry args={[30, 30]} />
                <meshStandardMaterial color="#d0d0d0" />
            </mesh>

            {/* Tables */}
            {[[-5, 0, -5], [5, 0, -5], [-5, 0, 5], [5, 0, 5]].map((pos, i) => (
                <group key={i} position={pos as any}>
                    {/* Table Top */}
                    <mesh position={[0, 0, 0]} material={materials.wood}><cylinderGeometry args={[1.5, 1.5, 0.1]} /></mesh>
                    {/* Table Leg */}
                    <mesh position={[0, -1, 0]} material={materials.metal}><cylinderGeometry args={[0.2, 0.2, 2]} /></mesh>

                    {/* Customers */}
                    <Customer position={[-1, -0.5, 0]} color="#4a90e2" />
                    <Customer position={[1, -0.5, 0]} color="#50e3c2" />
                    <Customer position={[0, -0.5, 1]} color="#f5a623" />
                </group>
            ))}
        </group>
    )
}

function CameraController() {
    const scroll = useScroll();
    const { camera } = useThree();

    useFrame(() => {
        // Scroll 0 to 1
        const r1 = scroll.range(0, 1 / 3); // 0 to 0.33
        const r2 = scroll.range(1 / 3, 1 / 3); // 0.33 to 0.66
        const r3 = scroll.range(2 / 3, 1 / 3); // 0.66 to 1

        // Initial Position: Close to Chef in Kitchen
        // Target 1: Pull back to see full kitchen
        // Target 2: Move down to Dining Area

        const kitchenClosePos = new THREE.Vector3(0, 0, 6);
        const kitchenFarPos = new THREE.Vector3(0, 2, 12);
        const diningPos = new THREE.Vector3(0, -15, 15);

        // Interpolation logic
        // 0 -> 0.33: Move from Close to Far
        // 0.33 -> 1: Move from Far to Dining

        const currentPos = new THREE.Vector3();

        if (scroll.offset < 0.33) {
            currentPos.lerpVectors(kitchenClosePos, kitchenFarPos, r1);
            camera.lookAt(0, 0, 0);
        } else {
            currentPos.lerpVectors(kitchenFarPos, diningPos, (scroll.offset - 0.33) * 1.5); // Accelerate slightly
            // Look target changes from Kitchen Center (0,0,0) to Dining Center (0, -20, 0)
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
                        <KitchenEnvironment />
                        <VoxelChef position={[1.5, -1, -2]} scale={1.5} rotation={[0, -0.3, 0]} />

                        {/* Extra Chefs/Staff to make it crowded */}
                        <VoxelChef position={[-2, -1, -4]} scale={1.2} rotation={[0, 0.5, 0]} />
                        <VoxelChef position={[4, -1, -6]} scale={1.2} rotation={[0, -0.5, 0]} />

                        {/* Clouds for atmosphere */}
                        <Cloud position={[-4, 3, -5]} opacity={0.3} speed={0.2} width={10} depth={1.5} segments={10} color="#fff" />
                    </group>

                    {/* Dining Scene */}
                    <DiningArea />

                </ScrollControls>
            </Canvas>
        </div>
    );
};
