import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Cloud, Float, PerspectiveCamera, Environment, ContactShadows, ScrollControls, useScroll, RoundedBox, OrthographicCamera } from '@react-three/drei';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

// --- Materials ---
const materials = {
  skin: new THREE.MeshStandardMaterial({ color: "#ffdbac", roughness: 0.3 }),
  white: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: "#333333", roughness: 0.4 }),
  red: new THREE.MeshStandardMaterial({ color: "#d65a5a", roughness: 0.3 }),
  metal: new THREE.MeshStandardMaterial({ color: "#aaaaaa", metalness: 0.4, roughness: 0.3 }),
  wood: new THREE.MeshStandardMaterial({ color: "#d4a373", roughness: 0.6 }), // Lighter wood
  orange: new THREE.MeshStandardMaterial({ color: "#ff9900", roughness: 0.3 }),
  wall: new THREE.MeshStandardMaterial({ color: "#fefae0", roughness: 0.8 }), // Creamy wall
  floor: new THREE.MeshStandardMaterial({ color: "#e9edc9", roughness: 0.6 }), // Light tile
  awningStripe1: new THREE.MeshStandardMaterial({ color: "#ffb703", roughness: 0.8 }), // Yellow/Orange
  awningStripe2: new THREE.MeshStandardMaterial({ color: "#fb8500", roughness: 0.8 }), // Darker Orange
  roof: new THREE.MeshStandardMaterial({ color: "#bc6c25", roughness: 0.9 }), // Brown roof
};

// --- Components ---

function SmoothChef({ position, scale = 1, rotation = [0, 0, 0] }: { position: [number, number, number], scale?: number, rotation?: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      // Idle animation
      groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.02;
    }
  });

  return (
    <group ref={groupRef} position={position} scale={scale} rotation={rotation as any}>
      {/* Head Group */}
      <group position={[0, 1.3, 0]}>
        <mesh position={[0, 0, 0]} material={materials.skin}>
            <sphereGeometry args={[0.4, 32, 32]} />
        </mesh>
        {/* Eyes */}
        <mesh position={[-0.12, 0.05, 0.35]} material={materials.dark}>
            <sphereGeometry args={[0.04, 16, 16]} />
        </mesh>
        <mesh position={[0.12, 0.05, 0.35]} material={materials.dark}>
            <sphereGeometry args={[0.04, 16, 16]} />
        </mesh>
        {/* Smile */}
        <mesh position={[0, -0.1, 0.35]} rotation={[0, 0, 0]} material={materials.red}>
             <torusGeometry args={[0.08, 0.02, 16, 32, Math.PI]} />
        </mesh>
        {/* Hat */}
        <group position={[0, 0.3, 0]}>
           <mesh position={[0, 0, 0]} material={materials.white}>
               <cylinderGeometry args={[0.4, 0.4, 0.2, 32]} />
           </mesh>
           <mesh position={[0, 0.25, 0]} material={materials.white}>
               <sphereGeometry args={[0.45, 32, 32]} />
           </mesh>
        </group>
      </group>

      {/* Body */}
      <mesh position={[0, 0.5, 0]} material={materials.white}>
          <capsuleGeometry args={[0.35, 0.8, 4, 16]} />
      </mesh>
      
      {/* Arms */}
      <group position={[-0.4, 0.7, 0]} rotation={[0, 0, 0.5]}>
        <mesh material={materials.white}>
            <capsuleGeometry args={[0.1, 0.5, 4, 16]} />
        </mesh>
        <mesh position={[0, -0.3, 0]} material={materials.skin}>
            <sphereGeometry args={[0.12, 16, 16]} />
        </mesh>
      </group>
      <group position={[0.4, 0.7, 0]} rotation={[0, 0, -0.5]}>
        <mesh material={materials.white}>
             <capsuleGeometry args={[0.1, 0.5, 4, 16]} />
        </mesh>
        <mesh position={[0, -0.3, 0]} material={materials.skin}>
             <sphereGeometry args={[0.12, 16, 16]} />
        </mesh>
      </group>

      {/* Legs */}
      <mesh position={[-0.2, -0.3, 0]} material={materials.dark}>
          <capsuleGeometry args={[0.12, 0.6, 4, 16]} />
      </mesh>
      <mesh position={[0.2, -0.3, 0]} material={materials.dark}>
           <capsuleGeometry args={[0.12, 0.6, 4, 16]} />
      </mesh>
    </group>
  );
}

function SmoothCustomer({ position, color, rotation = [0,0,0] }: { position: [number, number, number], color: string, rotation?: [number, number, number] }) {
    return (
        <group position={position} rotation={rotation as any}>
            {/* Head */}
            <mesh position={[0, 0.9, 0]} material={materials.skin}>
                <sphereGeometry args={[0.3, 32, 32]} />
            </mesh>
            {/* Body */}
            <mesh position={[0, 0.2, 0]}>
                <capsuleGeometry args={[0.3, 0.7, 4, 16]} />
                <meshStandardMaterial color={color} roughness={0.3} />
            </mesh>
            {/* Legs (Sitting) */}
             <mesh position={[-0.15, -0.3, 0.2]} rotation={[-1.5, 0, 0]}>
                <capsuleGeometry args={[0.1, 0.5, 4, 16]} />
                <meshStandardMaterial color="#333" />
            </mesh>
             <mesh position={[0.15, -0.3, 0.2]} rotation={[-1.5, 0, 0]}>
                <capsuleGeometry args={[0.1, 0.5, 4, 16]} />
                <meshStandardMaterial color="#333" />
            </mesh>
        </group>
    )
}

function Diorama() {
    return (
        <group position={[0, -1, 0]} rotation={[0, -Math.PI / 4, 0]}>
            {/* --- Base & Floor --- */}
            <RoundedBox args={[8, 0.5, 8]} radius={0.2} smoothness={4} position={[0, -0.25, 0]} material={materials.floor} receiveShadow />
            
            {/* --- Walls (Corner Cutaway) --- */}
            {/* Back Left Wall */}
            <RoundedBox args={[0.5, 5, 8]} radius={0.1} smoothness={4} position={[-3.75, 2.5, 0]} material={materials.wall} />
            {/* Back Right Wall */}
            <RoundedBox args={[8, 5, 0.5]} radius={0.1} smoothness={4} position={[0, 2.5, -3.75]} material={materials.wall} />

            {/* --- Roof/Awning --- */}
            <group position={[0, 5, 0]}>
                {/* Main Roof Structure */}
                <RoundedBox args={[8.5, 0.5, 8.5]} radius={0.1} smoothness={4} position={[0, 0, 0]} material={materials.roof} />
                
                {/* Awning over the front area */}
                <group position={[2, -0.5, 2]} rotation={[0.5, 0, 0]}>
                    {/* Striped Awning */}
                    {Array.from({ length: 5 }).map((_, i) => (
                        <RoundedBox 
                            key={i} 
                            args={[1, 0.2, 3]} 
                            radius={0.05} 
                            smoothness={4} 
                            position={[i * 1 - 2, 0, 0]} 
                            material={i % 2 === 0 ? materials.awningStripe1 : materials.awningStripe2} 
                        />
                    ))}
                </group>
            </group>

            {/* --- Interior: Kitchen --- */}
            <group position={[-1.5, 0, -1.5]}>
                {/* Counter */}
                <RoundedBox args={[4, 1.5, 1]} radius={0.1} smoothness={4} position={[0, 0.75, -1.5]} material={materials.wood} />
                <RoundedBox args={[1, 1.5, 4]} radius={0.1} smoothness={4} position={[-1.5, 0.75, 0]} material={materials.wood} />
                
                {/* Stove */}
                <RoundedBox args={[1.2, 1.6, 1.2]} radius={0.1} smoothness={4} position={[-1.5, 0.8, -1.5]} material={materials.metal} />
                <mesh position={[-1.5, 1.61, -1.5]} material={materials.dark}>
                    <cylinderGeometry args={[0.4, 0.4, 0.1, 32]} />
                </mesh>
                
                {/* Hood */}
                <group position={[-1.5, 3.5, -1.5]}>
                     <mesh material={materials.metal}>
                        <coneGeometry args={[1, 1.5, 4]} />
                     </mesh>
                </group>

                {/* Chef */}
                <SmoothChef position={[-0.5, 0, -0.5]} rotation={[0, Math.PI / 4, 0]} scale={1.1} />
            </group>

            {/* --- Exterior/Dining Area --- */}
            <group position={[1.5, 0, 1.5]}>
                {/* Table */}
                <group position={[0, 0, 0]}>
                    <mesh position={[0, 0.8, 0]} material={materials.wood}>
                        <cylinderGeometry args={[1.2, 1.2, 0.1, 32]} />
                    </mesh>
                    <mesh position={[0, 0.4, 0]} material={materials.metal}>
                        <cylinderGeometry args={[0.1, 0.1, 0.8, 16]} />
                    </mesh>
                    <mesh position={[0, 0.05, 0]} material={materials.metal}>
                        <cylinderGeometry args={[0.4, 0.4, 0.1, 16]} />
                    </mesh>
                </group>

                {/* Chairs & Customers */}
                {/* Customer 1 */}
                <group position={[-1, 0, 0]} rotation={[0, Math.PI/2, 0]}>
                    <RoundedBox args={[0.6, 0.6, 0.1]} radius={0.05} smoothness={4} position={[0, 0.8, -0.3]} material={materials.wood} /> {/* Back */}
                    <RoundedBox args={[0.6, 0.1, 0.6]} radius={0.05} smoothness={4} position={[0, 0.4, 0]} material={materials.wood} /> {/* Seat */}
                    <SmoothCustomer position={[0, 0.4, 0]} color="#4a90e2" rotation={[0, -Math.PI/2, 0]} />
                </group>

                {/* Customer 2 */}
                <group position={[1, 0, 0]} rotation={[0, -Math.PI/2, 0]}>
                    <RoundedBox args={[0.6, 0.6, 0.1]} radius={0.05} smoothness={4} position={[0, 0.8, -0.3]} material={materials.wood} />
                    <RoundedBox args={[0.6, 0.1, 0.6]} radius={0.05} smoothness={4} position={[0, 0.4, 0]} material={materials.wood} />
                    <SmoothCustomer position={[0, 0.4, 0]} color="#ff6b6b" rotation={[0, Math.PI/2, 0]} />
                </group>
            </group>

            {/* --- Lighting Props --- */}
            <pointLight position={[-1.5, 3, -1.5]} intensity={1.5} color="#ffaa00" distance={5} /> {/* Warm kitchen light */}
            <pointLight position={[1.5, 3, 1.5]} intensity={1} color="#ffddaa" distance={5} /> {/* Dining light */}

        </group>
    )
}


export const Scene3D = () => {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      <Canvas shadows dpr={[1, 2]}>
        {/* Isometric Camera */}
        <OrthographicCamera makeDefault position={[20, 20, 20]} zoom={40} near={-50} far={200} />
        
        {/* Lighting */}
        <ambientLight intensity={0.7} />
        <directionalLight 
            position={[10, 20, 10]} 
            intensity={1.2} 
            castShadow 
            shadow-mapSize={[1024, 1024]} 
        />
        <Environment preset="city" />

        {/* Floating Animation for the whole diorama */}
        <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
            <Diorama />
        </Float>

        {/* Clouds for atmosphere */}
        <Cloud position={[-8, 5, -10]} opacity={0.5} speed={0.2} width={10} depth={2} segments={10} color="#fff" />
        <Cloud position={[8, -2, -5]} opacity={0.3} speed={0.3} width={8} depth={2} segments={8} color="#fff" />

      </Canvas>
    </div>
  );
};
