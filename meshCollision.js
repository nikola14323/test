import * as THREE from 'three';

class MeshCollisionSystem {
  constructor() {
    this.collisionMeshes = new Map(); // modelName -> collision data
    this.raycaster = new THREE.Raycaster();
    this.tempVector = new THREE.Vector3();
    this.tempBox = new THREE.Box3();
    this.debugHelpers = new Map(); // For visualization
    this.debugMode = false;
  }
  // Register a model's collision mesh
  registerModelCollision(modelName, model) {
    const collisionData = this.extractCollisionData(model);
    this.collisionMeshes.set(modelName, collisionData);
    console.log(`Registered collision for model: ${modelName}`);
  }

  extractCollisionData(model) {
    if (!model) {
      console.error('Cannot extract collision data: model is null');
      return {
        meshes: [],
        boundingBox: new THREE.Box3(),
        center: new THREE.Vector3(),
        size: new THREE.Vector3(),
        modelPosition: new THREE.Vector3(),
        modelRotation: new THREE.Euler(),
        modelScale: new THREE.Vector3(1, 1, 1)
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

    return {
      meshes,
      boundingBox: finalBoundingBox,
      center: finalBoundingBox.getCenter(new THREE.Vector3()),
      size: finalBoundingBox.getSize(new THREE.Vector3()),
      modelPosition: model.position.clone(),
      modelRotation: model.rotation.clone(),
      modelScale: model.scale.clone()
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

 


  // Check collision with a specific model - simplified
  checkModelCollision(characterPosition, newPosition, characterRadius, collisionData) {
    // Quick bounding box check
    const expandedBox = collisionData.boundingBox.clone();
    expandedBox.expandByScalar(characterRadius);
    
    if (!expandedBox.containsPoint(newPosition)) {
      return false; // No collision possible
    }

    // Only do simple mesh check - no complex raycasting
    return this.checkMeshCollision(characterPosition, newPosition, characterRadius, collisionData.meshes);
  }

    // Detailed mesh collision detection - simplified
  checkMeshCollision(characterPosition, newPosition, characterRadius, meshes) {
    // Only check if we're actually close to any mesh
    for (const meshData of meshes) {
      if (this.checkSingleMeshCollision(characterPosition, newPosition, characterRadius, meshData)) {
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
    
    // Check movement ray to detect walls
    const movementDirection = new THREE.Vector3().subVectors(newPosition, characterPosition);
    const movementDistance = movementDirection.length();
    
    if (movementDistance > 0.001) {
      movementDirection.normalize();
      
      // Cast ray from character position in movement direction
      this.raycaster.set(characterPosition, movementDirection);
      const movementIntersects = this.raycaster.intersectObject(tempMesh, false);
      
      if (movementIntersects.length > 0) {
        const intersectDistance = movementIntersects[0].distance;
        // Block if we would hit the mesh
        if (intersectDistance < movementDistance + characterRadius) {
          return true;
        }
      }
    }
    
    // Check collision at new position
    const directions = [
      new THREE.Vector3(1, 0, 0),   // Right
      new THREE.Vector3(-1, 0, 0),  // Left
      new THREE.Vector3(0, 0, 1),   // Forward
      new THREE.Vector3(0, 0, -1),  // Backward
    ];

    for (const direction of directions) {
      const rayOrigin = newPosition.clone().add(direction.clone().multiplyScalar(characterRadius));
      const rayDirection = direction.clone().negate();
      
      this.raycaster.set(rayOrigin, rayDirection);
      const intersects = this.raycaster.intersectObject(tempMesh, false);
      
      // Block if we're intersecting with the mesh
      if (intersects.length > 0 && intersects[0].distance <= characterRadius) {
        return true;
      }
    }
    
    return false;
  }

   // More accurate sphere vs mesh collision
  checkSphereVsMesh(sphereCenter, sphereRadius, meshData) {
    const geometry = meshData.geometry;
    const positionAttribute = geometry.getAttribute('position');
    
    if (!positionAttribute) return false;

    const vertices = positionAttribute.array;
    const matrix = meshData.matrixWorld;
    
    // Check vertices more sparsely and with tighter radius
    for (let i = 0; i < vertices.length; i += 15) { // Check every 5th vertex (15 = 5 vertices * 3 components)
      this.tempVector.fromArray(vertices, i);
      this.tempVector.applyMatrix4(matrix);
      
      const distance = sphereCenter.distanceTo(this.tempVector);
      if (distance <= sphereRadius * 0.9) { // Tighter radius - only block when very close
        return true;
      }
    }
    
    // Check if sphere center is inside mesh (for concave objects)
    const tempMesh = new THREE.Mesh(geometry);
    tempMesh.matrixWorld.copy(matrix);
    
    this.raycaster.set(sphereCenter, new THREE.Vector3(1, 0, 0));
    const intersects = this.raycaster.intersectObject(tempMesh, false);
    
    // If odd number of intersections, we're inside - but be more lenient
    return intersects.length % 2 === 1 && intersects.length > 2;
  }

  // Check distance to mesh vertices
  checkVertexDistance(position, radius, meshData) {
    const geometry = meshData.geometry;
    const positionAttribute = geometry.getAttribute('position');
    
    if (!positionAttribute) return false;

    const vertices = positionAttribute.array;
    const matrix = meshData.matrixWorld;
    
    // Check every 5th vertex for better accuracy on angled surfaces
    for (let i = 0; i < vertices.length; i += 15) { // 15 = 5 vertices * 3 components
      this.tempVector.fromArray(vertices, i);
      this.tempVector.applyMatrix4(matrix);
      
      const distance = position.distanceTo(this.tempVector);
      if (distance <= radius * 1.05) { // Slightly larger radius for safety
        return true;
      }
    }
    
    return false;
  }

  // Get ground level from collision meshes
  getGroundLevel(position) {
    let maxGroundY = 0;
    
    for (const [modelName, collisionData] of this.collisionMeshes) {
      const groundY = this.getModelGroundLevel(position, collisionData);
      maxGroundY = Math.max(maxGroundY, groundY);
    }
    
    return maxGroundY;
  }

  // Get ground level from a specific model
  getModelGroundLevel(position, collisionData) {
    // Cast ray downward to find ground
    this.raycaster.set(
      new THREE.Vector3(position.x, position.y + 10, position.z),
      new THREE.Vector3(0, -1, 0)
    );

    let maxY = 0;
    
    for (const meshData of collisionData.meshes) {
      const tempMesh = new THREE.Mesh(meshData.geometry);
      tempMesh.matrixWorld.copy(meshData.matrixWorld);
      
      const intersects = this.raycaster.intersectObject(tempMesh, false);
      
      for (const intersect of intersects) {
        if (intersect.point.y > maxY) {
          maxY = intersect.point.y;
        }
      }
    }
    
    return maxY;
  }

    registerModelCollision(modelName, model) {
    if (!model) {
      console.error(`Cannot register collision for ${modelName}: model is null`);
      return;
    }
    
    const collisionData = this.extractCollisionData(model);
    this.collisionMeshes.set(modelName, collisionData);
    console.log(`Registered collision for model: ${modelName}`);
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
      // Create bounding box helper
      const boxHelper = new THREE.Box3Helper(collisionData.boundingBox, 0xff0000);
      boxHelper.name = `collision-debug-${modelName}`;
      scene.add(boxHelper);
      
      // Create wireframe for each mesh
      const meshHelpers = [];
      collisionData.meshes.forEach((meshData, index) => {
        const wireframe = new THREE.WireframeGeometry(meshData.geometry);
        const wireframeMaterial = new THREE.LineBasicMaterial({ 
          color: 0x00ff00,
          transparent: true,
          opacity: 0.3
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
