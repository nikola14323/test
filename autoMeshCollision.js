import * as THREE from 'three';

class AutoMeshCollision {
  constructor() {
    this.isActive = false;
    this.collisionMeshes = [];
    this.processedObjects = new Set();
    this.raycaster = new THREE.Raycaster();
    this.tempVector = new THREE.Vector3();
    this.characterRadius = 0.4;
    this.characterHeight = 2.0;
    
    // Wait for scene to be available
    this.waitForScene();
  }
  
  waitForScene() {
    const checkForScene = () => {
      if (window.scene && window.characterGroup) {
        console.log('AutoMeshCollision: Scene detected, initializing...');
        this.init();
      } else {
        setTimeout(checkForScene, 100);
      }
    };
    checkForScene();
  }
  
  init() {
    this.scene = window.scene;
    this.characterGroup = window.characterGroup;
    
    // Override the existing collision functions
    this.overrideCollisionFunctions();
    
    // Start monitoring for new models
    this.startModelDetection();
    
    // Process any existing models
    this.processExistingModels();
    
    this.isActive = true;
    console.log('AutoMeshCollision: System active - all visible meshes now have collision');
    
    // Expose to window for debugging
    window.autoMeshCollision = this;
  }
  
  overrideCollisionFunctions() {
    // Store original functions
    this.originalCheckCollision = window.checkCollision;
    this.originalGetGroundLevel = window.getGroundLevel;
    
    // Override checkCollision
    window.checkCollision = (currentPosition, newPosition) => {
      // First check original collision system
      if (this.originalCheckCollision && this.originalCheckCollision(currentPosition, newPosition)) {
        return true;
      }
      
      // Then check mesh collisions
      if (this.isActive) {
        return this.checkMeshCollision(currentPosition, newPosition);
      }
      
      return false;
    };
    
    // Override getGroundLevel
    window.getGroundLevel = (position) => {
      let groundLevel = this.originalGetGroundLevel ? this.originalGetGroundLevel(position) : 0;
      
      if (this.isActive) {
        const meshGroundLevel = this.getMeshGroundLevel(position);
        groundLevel = Math.max(groundLevel, meshGroundLevel);
      }
      
      return groundLevel;
    };
    
    console.log('AutoMeshCollision: Overrode collision functions');
  }
  
  startModelDetection() {
    // Check for new models every 200ms
    this.detectionInterval = setInterval(() => {
      if (this.isActive) {
        this.detectNewModels();
      }
    }, 200);
  }
  
  processExistingModels() {
    if (!this.scene) return;
    
    this.scene.traverse((object) => {
      if (this.shouldCreateCollisionFor(object)) {
        this.createCollisionForMesh(object);
      }
    });
    
    console.log(`AutoMeshCollision: Processed existing models, created ${this.collisionMeshes.length} collision meshes`);
  }
  
  detectNewModels() {
    if (!this.scene) return;
    
    this.scene.traverse((object) => {
      if (this.shouldCreateCollisionFor(object) && !this.processedObjects.has(object.uuid)) {
        this.createCollisionForMesh(object);
      }
    });
  }
  
  shouldCreateCollisionFor(object) {
    // Must be a mesh
    if (!object.isMesh || !object.geometry) return false;
    
    // Skip if already processed
    if (this.processedObjects.has(object.uuid)) return false;
    
    // Skip if it's a collision mesh we created
    if (object.userData.isAutoCollisionMesh) return false;
    
    // Skip wireframes and transparent objects
    if (object.material) {
      if (object.material.wireframe) return false;
      if (object.material.transparent && object.material.opacity < 0.5) return false;
      if (!object.material.visible) return false;
    }
    
    // Skip large objects (sky, etc.)
    const boundingBox = new THREE.Box3().setFromObject(object);
    const size = boundingBox.getSize(new THREE.Vector3());
    if (size.x > 100 || size.y > 100 || size.z > 100) return false;
    
    // Skip floor plane
    if (object.geometry.type === 'PlaneGeometry') {
      if (Math.abs(object.rotation.x + Math.PI/2) < 0.1 && object.position.y < 0.1) {
        return false;
      }
    }
    
    // Skip grid helpers and other utility objects
    const name = (object.name || '').toLowerCase();
    if (name.includes('grid') || name.includes('helper') || name.includes('sky') || 
        name.includes('sun') || name.includes('moon')) {
      return false;
    }
    
    // Skip coordinate grid objects
    if (object.parent && object.parent.name === 'coordinate-grid') return false;
    
    return true;
  }
  
  createCollisionForMesh(object) {
    try {
      // Mark as processed
      this.processedObjects.add(object.uuid);
      
      // Update world matrix
      object.updateMatrixWorld(true);
      
      // Clone the geometry and apply the world transform
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      
      // Create collision data
      const collisionData = {
        geometry: geometry,
        originalObject: object,
        boundingBox: new THREE.Box3().setFromBufferGeometry(geometry),
        uuid: object.uuid
      };
      
      this.collisionMeshes.push(collisionData);
      
      console.log(`AutoMeshCollision: Created collision for ${object.name || 'unnamed mesh'} (total: ${this.collisionMeshes.length})`);
      
    } catch (error) {
      console.warn('AutoMeshCollision: Failed to create collision for object:', error);
    }
  }
  
  checkMeshCollision(currentPosition, newPosition) {
    // Create character bounding sphere at new position
    const characterSphere = {
      center: newPosition.clone(),
      radius: this.characterRadius
    };
    
    // Check against all collision meshes
    for (const collisionData of this.collisionMeshes) {
      if (this.checkSphereVsMesh(characterSphere, collisionData)) {
        return true;
      }
    }
    
    return false;
  }
  
  checkSphereVsMesh(sphere, collisionData) {
    // Quick bounding box check first
    const expandedBox = collisionData.boundingBox.clone();
    expandedBox.expandByScalar(sphere.radius);
    
    if (!expandedBox.containsPoint(sphere.center)) {
      return false;
    }
    
    // Check if sphere intersects with mesh using raycasting
    const directions = [
      new THREE.Vector3(1, 0, 0),   // Right
      new THREE.Vector3(-1, 0, 0),  // Left
      new THREE.Vector3(0, 0, 1),   // Forward
      new THREE.Vector3(0, 0, -1),  // Backward
      new THREE.Vector3(0, 1, 0),   // Up
      new THREE.Vector3(0, -1, 0)   // Down
    ];
    
    // Create temporary mesh for raycasting
    const tempMesh = new THREE.Mesh(collisionData.geometry, new THREE.MeshBasicMaterial());
    
    for (const direction of directions) {
      // Cast ray from sphere center in each direction
      this.raycaster.set(sphere.center, direction);
      const intersects = this.raycaster.intersectObject(tempMesh, false);
      
      if (intersects.length > 0 && intersects[0].distance < sphere.radius) {
        return true;
      }
    }
    
    return false;
  }
  
  getMeshGroundLevel(position) {
    let maxGroundY = 0;
    
    // Cast ray downward from position
    const rayOrigin = new THREE.Vector3(position.x, position.y + 10, position.z);
    const rayDirection = new THREE.Vector3(0, -1, 0);
    this.raycaster.set(rayOrigin, rayDirection);
    
    for (const collisionData of this.collisionMeshes) {
      const tempMesh = new THREE.Mesh(collisionData.geometry, new THREE.MeshBasicMaterial());
      const intersects = this.raycaster.intersectObject(tempMesh, false);
      
      for (const intersect of intersects) {
        if (intersect.point.y > maxGroundY && intersect.point.y <= position.y + 1) {
          maxGroundY = intersect.point.y;
        }
      }
    }
    
    return maxGroundY;
  }
  
  // Clean up removed objects
  cleanup() {
    this.collisionMeshes = this.collisionMeshes.filter(collisionData => {
      const originalObject = collisionData.originalObject;
      
      // If original object no longer exists in scene, remove collision
      if (!originalObject || !originalObject.parent) {
        collisionData.geometry.dispose();
        this.processedObjects.delete(collisionData.uuid);
        return false;
      }
      
      return true;
    });
  }
  
  // Debug methods
  toggleDebugVisualization() {
    this.debugMode = !this.debugMode;
    
    if (this.debugMode) {
      this.showDebugVisualization();
    } else {
      this.hideDebugVisualization();
    }
    
    console.log(`AutoMeshCollision: Debug visualization ${this.debugMode ? 'enabled' : 'disabled'}`);
  }
  
  showDebugVisualization() {
    this.debugObjects = [];
    
    this.collisionMeshes.forEach((collisionData, index) => {
      // Create wireframe visualization
      const wireframe = new THREE.WireframeGeometry(collisionData.geometry);
      const wireframeMaterial = new THREE.LineBasicMaterial({ 
        color: 0x00ff00,
        transparent: true,
        opacity: 0.5
      });
      const wireframeMesh = new THREE.LineSegments(wireframe, wireframeMaterial);
      wireframeMesh.name = `debug-collision-${index}`;
      
      this.scene.add(wireframeMesh);
      this.debugObjects.push(wireframeMesh);
    });
  }
  
  hideDebugVisualization() {
    if (this.debugObjects) {
      this.debugObjects.forEach(obj => {
        this.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      });
      this.debugObjects = [];
    }
  }
  
  getDebugInfo() {
    return {
      isActive: this.isActive,
      totalCollisionMeshes: this.collisionMeshes.length,
      processedObjects: this.processedObjects.size,
      debugMode: this.debugMode || false
    };
  }
  
  destroy() {
    this.isActive = false;
    
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
    
    // Restore original functions
    if (this.originalCheckCollision) {
      window.checkCollision = this.originalCheckCollision;
    }
    if (this.originalGetGroundLevel) {
      window.getGroundLevel = this.originalGetGroundLevel;
    }
    
    // Clean up collision meshes
    this.collisionMeshes.forEach(collisionData => {
      collisionData.geometry.dispose();
    });
    
    this.hideDebugVisualization();
    
    console.log('AutoMeshCollision: System destroyed');
  }
}

// Auto-initialize when imported
new AutoMeshCollision();

export { AutoMeshCollision };
