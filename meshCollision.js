import * as THREE from 'three';

class MeshCollisionSystem {
  constructor() {
    this.collisionMeshes = new Map(); // modelName -> collision data
    this.raycaster = new THREE.Raycaster();
    this.tempVector = new THREE.Vector3();
    this.tempBox = new THREE.Box3();
    this.debugHelpers = new Map(); // For visualization
    this.debugMode = false;
    this.boundingBoxBuffer = 0.1; // Buffer zone around meshes to prevent camera glitching
  }

  // Register a model's collision mesh
  registerModelCollision(modelName, model) {
    if (!model) {
      console.error(`Cannot register collision for ${modelName}: model is null`);
      return;
    }
    
    if (typeof model.updateMatrixWorld !== 'function') {
      console.error(`Cannot register collision for ${modelName}: model is not a THREE.Object3D`, model);
      return;
    }
    
    const collisionData = this.extractCollisionData(model);
    this.collisionMeshes.set(modelName, collisionData);
    console.log(`Registered collision for model: ${modelName}`);
  }

  // Extract collision data from a model
  extractCollisionData(model) {
    if (!model || typeof model.updateMatrixWorld !== 'function') {
      console.error('Cannot extract collision data: invalid model');
      return {
        meshes: [],
        boundingBox: new THREE.Box3(),
        center: new THREE.Vector3(),
        size: new THREE.Vector3(),
        modelPosition: new THREE.Vector3(),
        modelRotation: new THREE.Euler(),
        modelScale: new THREE.Vector3(1, 1, 1),
        bufferSize: this.boundingBoxBuffer
      };
    }
    
    const meshes = [];
    const boundingBox = new THREE.Box3();
    
    // Force update the model's world matrix
    model.updateMatrixWorld(true);
    
    model.traverse((child) => {
      if (child.isMesh && child.geometry) {
        // Force update child's world matrix
        child.updateMatrixWorld(true);
        
        // Store mesh with current world matrix
        const meshData = {
          geometry: child.geometry,
          matrixWorld: child.matrixWorld.clone(),
          position: child.getWorldPosition(new THREE.Vector3()),
          scale: child.getWorldScale(new THREE.Vector3()),
          rotation: child.getWorldQuaternion(new THREE.Quaternion())
        };
        meshes.push(meshData);
        
        // Expand bounding box using the transformed child
        this.tempBox.setFromObject(child);
        boundingBox.union(this.tempBox);
      }
    });

    // Use the model's bounding box instead of individual meshes
    this.tempBox.setFromObject(model);
    const finalBoundingBox = this.tempBox.clone();

       // Use the same small buffer (key size) for ALL GLB models
    let customBuffer = 0.08; // Same buffer as key for all models

    return {
      meshes,
      boundingBox: finalBoundingBox,
      center: finalBoundingBox.getCenter(new THREE.Vector3()),
      size: finalBoundingBox.getSize(new THREE.Vector3()),
      modelPosition: model.position.clone(),
      modelRotation: model.rotation.clone(),
      modelScale: model.scale.clone(),
      bufferSize: customBuffer
    };
  }

  // Check collision between character and all registered models
  checkCollision(characterPosition, newPosition, characterRadius = 0.4) {
    for (const [modelName, collisionData] of this.collisionMeshes) {
      if (this.checkModelCollision(characterPosition, newPosition, characterRadius, collisionData)) {
        return true;
      }
    }
    return false;
  }
  
  // Check collision with a specific model
  checkModelCollision(characterPosition, newPosition, characterRadius, collisionData) {
    // Quick bounding box check for optimization only
    const expandedBox = collisionData.boundingBox.clone();
    expandedBox.expandByScalar(characterRadius + 1.0); // Large expansion for optimization only
    
    if (!expandedBox.containsPoint(newPosition)) {
      return false; // No collision possible - character is far from model
    }

    // Use detailed mesh collision check with buffer around actual geometry
    return this.checkMeshCollision(characterPosition, newPosition, characterRadius, collisionData);
  }

  // Detailed mesh collision detection with buffer
  checkMeshCollision(characterPosition, newPosition, characterRadius, collisionData) {
    const bufferSize = collisionData.bufferSize || this.boundingBoxBuffer;
    const totalRadius = characterRadius + bufferSize;
    
    for (const meshData of collisionData.meshes) {
      if (this.checkSingleMeshCollision(characterPosition, newPosition, totalRadius, meshData)) {
        return true;
      }
    }
    return false;
  }

  // Check collision with a single mesh
  checkSingleMeshCollision(characterPosition, newPosition, characterRadius, meshData) {
    // Create a temporary mesh for raycasting
    const tempMesh = new THREE.Mesh(meshData.geometry);
    tempMesh.matrixWorld.copy(meshData.matrixWorld);
    
    // Check multiple rays around the character at new position
    const directions = [
      new THREE.Vector3(1, 0, 0),   // Right
      new THREE.Vector3(-1, 0, 0),  // Left
      new THREE.Vector3(0, 0, 1),   // Forward
      new THREE.Vector3(0, 0, -1),  // Backward
      new THREE.Vector3(0.707, 0, 0.707),   // Diagonal
      new THREE.Vector3(-0.707, 0, 0.707),  // Diagonal
      new THREE.Vector3(0.707, 0, -0.707),  // Diagonal
      new THREE.Vector3(-0.707, 0, -0.707), // Diagonal
    ];

    // Test rays from character edge to mesh
    for (const direction of directions) {
      const rayOrigin = newPosition.clone().add(direction.clone().multiplyScalar(characterRadius));
      rayOrigin.y = characterPosition.y + 1.0; // Fixed height for collision rays
      const rayDirection = direction.clone().negate();
      
      this.raycaster.set(rayOrigin, rayDirection);
      const intersects = this.raycaster.intersectObject(tempMesh, false);
      
      // Check if mesh is within collision distance
      if (intersects.length > 0 && intersects[0].distance <= characterRadius * 0.7) {
        return true;
      }
    }

    // Also check vertex proximity
    return this.checkVertexDistance(newPosition, characterRadius, meshData);
  }

  // Check distance to mesh vertices
  checkVertexDistance(position, radius, meshData) {
    const geometry = meshData.geometry;
    const positionAttribute = geometry.getAttribute('position');
    
    if (!positionAttribute) return false;

    const vertices = positionAttribute.array;
    const matrix = meshData.matrixWorld;
    
    // Check every 10th vertex for performance
    for (let i = 0; i < vertices.length; i += 30) { // 30 = 10 vertices * 3 components
      this.tempVector.fromArray(vertices, i);
      this.tempVector.applyMatrix4(matrix);
      
      // Only check horizontal distance (ignore Y difference)
      const dx = position.x - this.tempVector.x;
      const dz = position.z - this.tempVector.z;
      const horizontalDistance = Math.sqrt(dx*dx + dz*dz);
      
      if (horizontalDistance <= radius * 0.8) {
        return true;
      }
    }
    
    return false;
  }

  // Remove collision data for a model
  unregisterModelCollision(modelName) {
    this.collisionMeshes.delete(modelName);
    console.log(`Unregistered collision for model: ${modelName}`);
  }

  // Clear all collision data
  clearAllCollisions() {
    this.collisionMeshes.clear();
    console.log('Cleared all collision data');
  }

  // Get debug info
  getDebugInfo() {
    return {
      registeredModels: Array.from(this.collisionMeshes.keys()),
      totalMeshes: Array.from(this.collisionMeshes.values()).reduce((sum, data) => sum + data.meshes.length, 0),
      debugMode: this.debugMode
    };
  }

  // Toggle debug visualization
  toggleDebugMode(scene) {
    this.debugMode = !this.debugMode;
    
    if (this.debugMode) {
      this.showDebugHelpers(scene);
    } else {
      this.hideDebugHelpers(scene);
    }
    
    console.log(`Mesh collision debug mode: ${this.debugMode ? 'ON' : 'OFF'}`);
    return this.debugMode;
  }

  // Show debug helpers
  showDebugHelpers(scene) {
    this.collisionMeshes.forEach((collisionData, modelName) => {
      // Create bounding box helper (red) - just for reference
      const boxHelper = new THREE.Box3Helper(collisionData.boundingBox, 0xff0000);
      boxHelper.name = `collision-debug-${modelName}`;
      scene.add(boxHelper);
      
      // Create wireframe for each mesh (green = actual collision area)
      const meshHelpers = [];
      collisionData.meshes.forEach((meshData, index) => {
        const wireframe = new THREE.WireframeGeometry(meshData.geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ 
          color: 0x00ff00,
          transparent: true,
          opacity: 0.5
        });
        const wireframeMesh = new THREE.LineSegments(wireframe, wireframeMaterial);
        
        // Apply the same transform as the original mesh
        wireframeMesh.applyMatrix4(meshData.matrixWorld);
        wireframeMesh.name = `collision-mesh-debug-${modelName}-${index}`;
        
        scene.add(wireframeMesh);
        meshHelpers.push(wireframeMesh);
      });
      
      this.debugHelpers.set(modelName, {
        boxHelper: boxHelper,
        meshHelpers: meshHelpers
      });
    });
  }

  // Hide debug helpers
  hideDebugHelpers(scene) {
    this.debugHelpers.forEach((helpers, modelName) => {
      // Remove box helper
      scene.remove(helpers.boxHelper);
      
      // Remove mesh helpers
      helpers.meshHelpers.forEach(helper => {
        scene.remove(helper);
      });
    });
    
    this.debugHelpers.clear();
  }

  // Update debug helpers (call this when models move)
  updateDebugHelpers(scene) {
    if (!this.debugMode) return;
    
    this.hideDebugHelpers(scene);
    this.showDebugHelpers(scene);
  }
}

export { MeshCollisionSystem };