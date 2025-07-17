import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

class WorldBuilder {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    
    this.isBuilderMode = false;
    this.availableModels = new Map();
    this.placedObjects = [];
    this.selectedModel = null;
    this.selectedObject = null;
    this.currentMode = 'select';
    
    this.placedCollisionBoxes = [];
    
    this.keys = {};
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.loader.setDRACOLoader(dracoLoader);
    
    this.rotationPanel = null;
    this.queuedWorldData = null;
    
    this.addBuiltInCollisionShapes();
    this.init();
  }
  
  addBuiltInCollisionShapes() {
    const cubeGeometry = new THREE.BoxGeometry(2, 2, 2);
    const cubeMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x0066ff,
      transparent: true, 
      opacity: 0.4,
      wireframe: true 
    });
    const cubeScene = new THREE.Group();
    const cubeMesh = new THREE.Mesh(cubeGeometry, cubeMaterial);
    cubeScene.add(cubeMesh);
    
    this.availableModels.set('collision_cube', {
      scene: cubeScene,
      isCollisionShape: true,
      shapeType: 'box',
      animations: []
    });
    
    const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 2, 12);
    const cylinderMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff00ff,
      transparent: true, 
      opacity: 0.4,
      wireframe: true 
    });
    const cylinderScene = new THREE.Group();
    const cylinderMesh = new THREE.Mesh(cylinderGeometry, cylinderMaterial);
    cylinderScene.add(cylinderMesh);
    
    this.availableModels.set('collision_cylinder', {
      scene: cylinderScene,
      isCollisionShape: true,
      shapeType: 'cylinder',
      animations: []
    });
  }
  
  init() {
    this.createUI();
    this.setupEventListeners();
    this.loadWorldConfig();
    this.setupAutoSave();
    this.autoLoadWorld();
  }
  
  async autoLoadWorld() {
    const stored = localStorage.getItem('world-builder-save');
    if (stored) {
      try {
        const worldData = JSON.parse(stored);
        this.queuedWorldData = worldData;
        const requiredModels = [...new Set(worldData.objects
          .map(obj => obj.modelName)
          .filter(name => !name.startsWith('collision_'))
        )];
        
        return requiredModels;
      } catch (error) {
        console.error('Failed to parse world data:', error);
      }
    }
    
    return [];
  }

async loadWorldWhenReady(retryCount = 0) {
  if (!this.queuedWorldData) return 0;
  
  const worldData = this.queuedWorldData;
  const requiredModels = [...new Set(worldData.objects
    .map(obj => obj.modelName)
    .filter(name => !name.startsWith('collision_'))
  )];
  
  const availableModels = Array.from(this.availableModels.keys());
  const missingModels = requiredModels.filter(model => !this.availableModels.has(model));
  
  if (missingModels.length > 0) {
    if (retryCount < 10) {
      setTimeout(() => {
        this.loadWorldWhenReady(retryCount + 1);
      }, 1000 + (retryCount * 500));
      return 0;
    } else {
      console.warn('Some models are missing:', missingModels);
      return 0;
    }
  }
  
  // Clear existing objects
  this.placedObjects.forEach(obj => this.scene.remove(obj));
  this.placedObjects = [];
  this.placedCollisionBoxes.forEach(box => this.scene.remove(box));
  this.placedCollisionBoxes = [];
  
  let loadedCount = 0;
  for (const objData of worldData.objects) {
    if (this.availableModels.has(objData.modelName)) {
      const modelData = this.availableModels.get(objData.modelName);
      const obj = modelData.scene.clone();
      
      // Apply saved transform data
      obj.position.set(objData.position.x, objData.position.y, objData.position.z);
      obj.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z);
      obj.scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
      
      // IMPORTANT: Set up proper userData for World Builder manipulation
      obj.userData = {
        ...objData.userData,
        type: 'world-builder-object', // This is crucial!
        modelName: objData.modelName,
        instanceId: objData.instanceId || (Date.now() + Math.random()),
        created: objData.userData.created || new Date().toISOString(),
        isCollisionShape: modelData.isCollisionShape || objData.userData.isCollisionShape || false,
        shapeType: modelData.shapeType || objData.userData.shapeType || null
      };
      
      this.scene.add(obj);
      
      // Add to the correct tracking arrays
      if (modelData.isCollisionShape || objData.userData.isCollisionShape) {
        this.placedCollisionBoxes.push(obj);
      } else {
        this.placedObjects.push(obj);
        
        // Register collision IMMEDIATELY for loaded non-collision models
        if (window.meshCollisionSystem && !objData.modelName.startsWith('collision_')) {
          // Force update the model's matrix first
          obj.updateMatrixWorld(true);
          
          const instanceName = objData.instanceName || `${objData.modelName}_${objData.instanceId}`;
          window.meshCollisionSystem.registerModelCollision(instanceName, obj);
          console.log(`Registered collision for loaded model: ${instanceName}`);
        }
      }
      
      loadedCount++;
    } else {
      console.warn(`Model '${objData.modelName}' not available for loading`);
    }
  }
  
  // Update the UI to show loaded objects
  this.updateObjectList();
  this.queuedWorldData = null;
  
  console.log(`World loaded: ${loadedCount} objects restored and ready for manipulation`);
  return loadedCount;
}
    
  registerModel(modelName, modelData) {
    this.availableModels.set(modelName, modelData);
    
    if (this.queuedWorldData) {
      setTimeout(() => this.loadWorldWhenReady(), 100);
    }
  }

  exportForProduction() {
    const allObjects = [...this.placedObjects, ...this.placedCollisionBoxes];
    const worldData = {
      version: '1.0',
      created: new Date().toISOString(),
      isProduction: true,
      objects: allObjects.map((obj, index) => ({
        modelName: obj.userData.modelName,
        instanceId: obj.userData.instanceId || (Date.now() + index),
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
        userData: obj.userData
      }))
    };
    
    localStorage.setItem('world-builder-save', JSON.stringify(worldData));
    const blob = new Blob([JSON.stringify(worldData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `default-world.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showStatus(`World saved! Put 'default-world.json' in /worlds/ folder (${allObjects.length} objects)`, 4000);
  }
    async autoLoadWorld() {
    try {
      const response = await fetch('./worlds/default-world.json');
      
      if (response.ok) {
        const worldData = await response.json();
        
        this.queuedWorldData = worldData;
        
        const requiredModels = [...new Set(worldData.objects
          .map(obj => obj.modelName)
          .filter(name => !name.startsWith('collision_'))
        )];
        
        return requiredModels;
      }
    } catch (error) {
    }
    
    const stored = localStorage.getItem('world-builder-save');
    if (stored) {
      try {
        const worldData = JSON.parse(stored);
        this.queuedWorldData = worldData;
        const requiredModels = [...new Set(worldData.objects
          .map(obj => obj.modelName)
          .filter(name => !name.startsWith('collision_'))
        )];
        
        return requiredModels;
      } catch (error) {
        console.error('Failed to parse localStorage world data:', error);
      }
    }
    return [];
  }

  resetToDefault() {
    localStorage.removeItem('world-builder-save');
    this.placedObjects.forEach(obj => this.scene.remove(obj));
    this.placedCollisionBoxes.forEach(box => this.scene.remove(box));
    this.placedObjects = [];
    this.placedCollisionBoxes = [];
    this.clearSelection();
    this.updateObjectList();
    this.showStatus(' Reset to empty world', 2000);
  }

  debugWorldState() {
    console.log('World Builder Debug:');
    console.log('- Available models:', Array.from(this.availableModels.keys()));
    console.log('- Placed objects:', this.placedObjects.length);
    console.log('- Collision boxes:', this.placedCollisionBoxes.length);
    console.log('- Queued world data:', this.queuedWorldData ? 'Yes' : 'No');
    
    const stored = localStorage.getItem('world-builder-save');
    if (stored) {
      try {
        const worldData = JSON.parse(stored);
        console.log('- Saved world objects:', worldData.objects.length);
        console.log('- Required models:', [...new Set(worldData.objects.map(obj => obj.modelName))]);
      } catch (e) {
        console.log('- Saved world: Invalid JSON');
      }
    } else {
      console.log('- Saved world: None');
    }
  }
  
  createUI() {
    this.builderPanel = document.createElement('div');
    this.builderPanel.id = 'world-builder-panel';
    this.builderPanel.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      width: 350px;
      max-height: 80vh;
      background: rgba(0, 0, 0, 0.9);
      border: 2px solid rgb(194, 194, 194);
      border-radius: 10px;
      color: white;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      padding: 15px;
      display: none;
      z-index: 5000;
      overflow-y: auto;
    `;
    
    this.builderPanel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid  rgb(194, 194, 194); padding-bottom: 10px;">
        <h3 style="margin: 0; color: rgb(194, 194, 194);"> BUILDER</h3>
        <button onclick="worldBuilder.toggleBuilder()" style="
          background: #ff4444; color: white; border: none; padding: 5px 10px; 
          border-radius: 3px; cursor: pointer; font-size: 11px;">✕</button>
      </div>
      
      <!-- Current Mode Display -->
      <div id="wb-mode-display" style="
        background:  rgb(194, 194, 194); padding: 10px; margin-bottom: 15px; 
        border-radius: 5px; text-align: center; font-weight: bold;
      ">
        MODE: SELECT
      </div>

      <!-- Production Controls -->
      <div style="margin-bottom: 15px; border-top: 1px solid #666; padding-top: 15px;">
        <h4 style="color: rgb(194, 194, 194); margin: 0 0 8px 0;">Controls</h4>
        <div style="display: grid; grid-template-columns: 1fr; gap: 5px;">
          <button onclick="worldBuilder.exportForProduction()" style="
            padding: 6px; background: rgb(194, 194, 194); color: white; border: 1px solid rgb(194, 194, 194); 
            border-radius: 3px; cursor: pointer; font-size: 11px;">Set as Default</button>
          <button onclick="worldBuilder.resetToDefault()" style="
            padding: 6px; background: rgb(194, 194, 194); color: white; border: 1px solid  rgb(194, 194, 194); 
            border-radius: 3px; cursor: pointer; font-size: 11px;">Reset to Default</button>
          <button onclick="worldBuilder.debugWorldState()" style="
            padding: 6px; background:  rgb(194, 194, 194); color: white; border: 1px solid  rgb(194, 194, 194); 
            border-radius: 3px; cursor: pointer; font-size: 11px;">Debug State</button>
        </div>
      </div>
      
      <!-- Drop Zone -->
      <div id="wb-drop-zone" style="
        border: 2px dashed rgb(194, 194, 194); padding: 15px; text-align: center; 
        margin-bottom: 15px; border-radius: 5px; cursor: pointer;
      ">
        .glb upload
      </div>
      <input type="file" id="wb-file-input" multiple accept=".glb,.gltf" style="display: none;">
      
      <!-- Model Library -->
      <div style="margin-bottom: 15px;">
        <h4 style="color:  rgb(194, 194, 194); margin: 0 0 8px 0;"> Current Library</h4>
        <div id="wb-model-list" style="
          max-height: 150px; overflow-y: auto; background: rgba(255,255,255,0.05); 
          padding: 8px; border-radius: 5px;
        ">
          <div style="color: #888; text-align: center; padding: 20px;">
            No models loaded.
          </div>
        </div>
      </div>
      
      <!-- Controls Reference -->
      <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 5px; font-size: 11px; margin-bottom: 15px;">
        <strong style="color: rgb(194, 194, 194);"> Controls:</strong><br>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;"></strong> X top right to exit</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;"></strong> ESC to move mouse free and scroll HERE</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;">T</strong> - Toggle Place Mode (surface/10m ahead)</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;">Z</strong> - Toggle Select Mode</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;">V</strong> - Toggle Move Mode (surface/10m ahead)</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;">R</strong> - Cycle Rotation Axis (X→Y→Z), scroll to rotate</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;">S</strong> - Cycle Scale Axis (X→Y→Z→All), scroll to scale</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;">Click</strong> - Confirm action</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;">Delete</strong> - Remove Selected</div>
        <div style="margin: 5px 0;"><strong style="color: #ffff00;">ESC</strong> - Free mouse to use panel</div>
      </div>

      
      <!-- Quick Actions -->
      <div style="margin-bottom: 15px;">
        <h4 style="color: #ffff00; margin: 0 0 8px 0;">Quick Actions</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px;">
          <button onclick="worldBuilder.deleteSelected()" style="
            padding: 6px; background:rgb(44, 44, 44); color: white; border: 1px solid rgb(44, 44, 44); 
            border-radius: 3px; cursor: pointer; font-size: 11px;">Delete</button>
          <button onclick="worldBuilder.duplicateSelected()" style="
            padding: 6px; background: rgb(44, 44, 44); color: white; border: 1px solid rgb(44, 44, 44); 
            border-radius: 3px; cursor: pointer; font-size: 11px;">Copy</button>
          <button onclick="worldBuilder.saveWorld()" style="
            padding: 6px; background:rgb(44, 44, 44); color: white; border: 1px solid rgb(44, 44, 44); 
            border-radius: 3px; cursor: pointer; font-size: 11px;">Save</button>
          <button onclick="worldBuilder.loadWorld()" style="
            padding: 6px; background: rgb(44, 44, 44); color: white; border: 1px solid rgb(44, 44, 44); 
            border-radius: 3px; cursor: pointer; font-size: 11px;">Load</button>
        </div>
      </div>
      
      <!-- Placed Objects -->
      <div style="margin-top: 15px;">
        <h4 style="color: #ffff00; margin: 0 0 8px 0;">All Objects (<span id="wb-object-count">0</span>)</h4>
        <div id="wb-object-list" style="
          max-height: 100px; overflow-y: auto; background: rgba(255,255,255,0.05); 
          padding: 8px; border-radius: 5px; font-size: 10px;
        ">
        </div>
      </div>
    `;
    
    document.body.appendChild(this.builderPanel);
    this.createRotationPanel();
    window.worldBuilder = this;
    
    this.statusIndicator = document.createElement('div');
    this.statusIndicator.style.cssText = `
      position: fixed; bottom: 20px; left: 20px; background: rgba(0,0,0,0.8);
      color: rgb(194, 194, 194); padding: 8px 15px; border-radius: 20px; font-family: 'Courier New', monospace;
      font-size: 12px; display: none; z-index: 5000;
    `;
    document.body.appendChild(this.statusIndicator);
  }
    createRotationPanel() {
    this.rotationPanel = document.createElement('div');
    this.rotationPanel.id = 'wb-rotation-panel';
    this.rotationPanel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 400px;
      background: rgba(0, 0, 0, 0.95);
      border: 2px solid #ffaa00;
      border-radius: 10px;
      color: white;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      padding: 20px;
      display: none;
      z-index: 6000;
    `;
    
    this.rotationPanel.innerHTML = `
      <div style="text-align: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #ffaa00;">ROTATION</h3>
        <div style="color: #888; font-size: 10px; margin-top: 5px;">Use sliders or input precise values</div>
      </div>
      
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; color: #ffaa00;">X Rotation:</label>
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="range" id="wb-rot-x" min="-180" max="180" value="0" step="1" style="flex: 1;">
          <input type="number" id="wb-rot-x-num" min="-180" max="180" value="0" step="1" style="width: 60px; background: #333; color: white; border: 1px solid #666; padding: 2px;">
          <span style="color: #888;">°</span>
        </div>
      </div>
      
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; color: #ffaa00;">Y Rotation:</label>
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="range" id="wb-rot-y" min="-180" max="180" value="0" step="1" style="flex: 1;">
          <input type="number" id="wb-rot-y-num" min="-180" max="180" value="0" step="1" style="width: 60px; background: #333; color: white; border: 1px solid #666; padding: 2px;">
          <span style="color: #888;">°</span>
        </div>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 5px; color: #ffaa00;">Z Rotation:</label>
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="range" id="wb-rot-z" min="-180" max="180" value="0" step="1" style="flex: 1;">
          <input type="number" id="wb-rot-z-num" min="-180" max="180" value="0" step="1" style="width: 60px; background: #333; color: white; border: 1px solid #666; padding: 2px;">
          <span style="color: #888;">°</span>
        </div>
      </div>
      
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button onclick="worldBuilder.resetRotation()" style="
          padding: 8px 15px; background: #444; color: white; border: 1px solid #666; 
          border-radius: 3px; cursor: pointer;">Reset</button>
        <button onclick="worldBuilder.closeRotationPanel()" style="
          padding: 8px 15px; background: rgb(194, 194, 194); color: white; border: 1px solid rgb(194, 194, 194); 
          border-radius: 3px; cursor: pointer;">Done</button>
      </div>
    `;
    
    document.body.appendChild(this.rotationPanel);
    this.setupRotationPanelListeners();
  }
  
  setupRotationPanelListeners() {
    const xSlider = document.getElementById('wb-rot-x');
    const ySlider = document.getElementById('wb-rot-y');
    const zSlider = document.getElementById('wb-rot-z');
    const xNum = document.getElementById('wb-rot-x-num');
    const yNum = document.getElementById('wb-rot-y-num');
    const zNum = document.getElementById('wb-rot-z-num');
    
    xSlider.addEventListener('input', () => {
      xNum.value = xSlider.value;
      this.updateObjectRotation();
    });
    
    ySlider.addEventListener('input', () => {
      yNum.value = ySlider.value;
      this.updateObjectRotation();
    });
    
    zSlider.addEventListener('input', () => {
      zNum.value = zSlider.value;
      this.updateObjectRotation();
    });
    
    xNum.addEventListener('input', () => {
      xSlider.value = xNum.value;
      this.updateObjectRotation();
    });
    
    yNum.addEventListener('input', () => {
      ySlider.value = yNum.value;
      this.updateObjectRotation();
    });
    
    zNum.addEventListener('input', () => {
      zSlider.value = zNum.value;
      this.updateObjectRotation();
    });
  }
  
  updateObjectRotation() {
    if (!this.selectedObject) return;
    
    const x = parseFloat(document.getElementById('wb-rot-x').value) * Math.PI / 180;
    const y = parseFloat(document.getElementById('wb-rot-y').value) * Math.PI / 180;
    const z = parseFloat(document.getElementById('wb-rot-z').value) * Math.PI / 180;
    
    this.selectedObject.rotation.set(x, y, z);
  }
  
  resetRotation() {
    document.getElementById('wb-rot-x').value = 0;
    document.getElementById('wb-rot-y').value = 0;
    document.getElementById('wb-rot-z').value = 0;
    document.getElementById('wb-rot-x-num').value = 0;
    document.getElementById('wb-rot-y-num').value = 0;
    document.getElementById('wb-rot-z-num').value = 0;
    this.updateObjectRotation();
  }
  
  closeRotationPanel() {
    this.rotationPanel.style.display = 'none';
    this.setMode('select');
  }
  
setupEventListeners() {
    const dropZone = document.getElementById('wb-drop-zone');
    const fileInput = document.getElementById('wb-file-input');
    
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#00ff00';
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = '#00ffff';
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#00ffff';
        this.handleFiles(e.dataTransfer.files);
      });
      fileInput.addEventListener('change', (e) => {
        this.handleFiles(e.target.files);
      });
    }
    
    this.rotationAxis = 'x'; // Track current rotation axis
    this.scaleAxis = 'uniform'; // Track current scale axis (x, y, z, uniform)
    this.precisionMoveStep = 0.1; // Default precision step
    
    document.addEventListener('keydown', (e) => {
      // Always check for Ctrl+B to toggle builder mode
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        this.toggleBuilder();
        return;
      }
      
      if (!this.isBuilderMode) return;
      
      // Handle numpad precision movement (only in move mode with selected object)
      if (this.currentMode === 'move' && this.selectedObject) {
        let moved = false;
        const step = this.precisionMoveStep;
        
        switch (e.code) {
          case 'Numpad7': // -X
            e.preventDefault();
            this.selectedObject.position.x -= step;
            this.showStatus(`Moved -X: ${this.selectedObject.position.x.toFixed(3)}`, 1000);
            moved = true;
            break;
          case 'Numpad8': // +X
            e.preventDefault();
            this.selectedObject.position.x += step;
            this.showStatus(`Moved +X: ${this.selectedObject.position.x.toFixed(3)}`, 1000);
            moved = true;
            break;
          case 'Numpad4': // -Y
            e.preventDefault();
            this.selectedObject.position.y -= step;
            this.showStatus(`Moved -Y: ${this.selectedObject.position.y.toFixed(3)}`, 1000);
            moved = true;
            break;
          case 'Numpad5': // +Y
            e.preventDefault();
            this.selectedObject.position.y += step;
            this.showStatus(`Moved +Y: ${this.selectedObject.position.y.toFixed(3)}`, 1000);
            moved = true;
            break;
          case 'Numpad1': // -Z
            e.preventDefault();
            this.selectedObject.position.z -= step;
            this.showStatus(`Moved -Z: ${this.selectedObject.position.z.toFixed(3)}`, 1000);
            moved = true;
            break;
          case 'Numpad2': // +Z
            e.preventDefault();
            this.selectedObject.position.z += step;
            this.showStatus(`Moved +Z: ${this.selectedObject.position.z.toFixed(3)}`, 1000);
            moved = true;
            break;
        }
        
        if (moved) {
          this.updateObjectList();
          return; // Don't process other keys if we handled numpad
        }
      }
      
      // Handle precision step adjustment (Shift + Numpad keys)
      if (e.shiftKey && this.currentMode === 'move' && this.selectedObject) {
        switch (e.code) {
          case 'NumpadAdd': // Shift + Numpad Plus - increase step
            e.preventDefault();
            this.precisionMoveStep = Math.min(this.precisionMoveStep * 2, 10);
            this.showStatus(`Precision step: ${this.precisionMoveStep.toFixed(3)}`, 1500);
            return;
          case 'NumpadSubtract': // Shift + Numpad Minus - decrease step
            e.preventDefault();
            this.precisionMoveStep = Math.max(this.precisionMoveStep / 2, 0.001);
            this.showStatus(`Precision step: ${this.precisionMoveStep.toFixed(3)}`, 1500);
            return;
        }
      }
      
      // Regular World Builder controls
      switch (e.key.toLowerCase()) {
        case 't':
          e.preventDefault();
          this.toggleMode('place');
          break;
        case 'z':
          e.preventDefault();
          this.toggleMode('select');
          break;
        case 'r':
          e.preventDefault();
          if (this.selectedObject) {
            this.cycleRotationAxis();
          } else {
            this.showStatus('Select an object first to rotate', 2000);
          }
          break;
        case 'f': // Keep F key for scale
          e.preventDefault();
          if (this.selectedObject) {
            this.cycleScaleAxis();
          } else {
            this.showStatus('Select an object first to scale', 2000);
          }
          break;
        case 'v':
          e.preventDefault();
          if (this.selectedObject) {
            this.setMode('move');
            this.showStatus(`Move mode - Use numpad for precision: Step=${this.precisionMoveStep.toFixed(3)}`, 2000);
          } else {
            this.showStatus('Select an object first to move', 2000);
          }
          break;
      }
      
      if (this.selectedObject && this.currentMode === 'move' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        this.fineMoveObject(e.key);
      }
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.deleteSelected();
      }
      
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveWorld();
      }
      
      if (e.ctrlKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.duplicateSelected();
      }
    });
    
    document.addEventListener('click', (e) => {
      if (!this.isBuilderMode) return;
      if (e.target.closest('#world-builder-panel')) return;
      if (e.target.closest('#wb-rotation-panel')) return;
      
      this.handleWorldClick(e);
    });
    
    document.addEventListener('wheel', (e) => {
      if (!this.isBuilderMode || !this.selectedObject) return;
      
      e.preventDefault();
      
      if (this.currentMode === 'scale') {
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        
        if (this.scaleAxis === 'uniform') {
          // Uniform scaling (all axes)
          const currentScale = this.selectedObject.scale.x;
          const newScale = Math.max(0.01, Math.min(10, currentScale + delta));
          this.selectedObject.scale.setScalar(newScale);
          this.showStatus(`Uniform Scale: ${newScale.toFixed(3)} (scroll to adjust, click to confirm)`, 500);
        } else {
          // Axis-specific scaling
          const currentScale = this.selectedObject.scale[this.scaleAxis];
          const newScale = Math.max(0.01, Math.min(10, currentScale + delta));
          this.selectedObject.scale[this.scaleAxis] = newScale;
          this.showStatus(`${this.scaleAxis.toUpperCase()} Scale: ${newScale.toFixed(3)} (scroll to adjust, click to confirm)`, 500);
        }
      } else if (this.currentMode === 'rotate') {
        const delta = e.deltaY > 0 ? -Math.PI/12 : Math.PI/12; // 15 degrees per scroll
        
        switch (this.rotationAxis) {
          case 'x':
            this.selectedObject.rotation.x += delta;
            break;
          case 'y':
            this.selectedObject.rotation.y += delta;
            break;
          case 'z':
            this.selectedObject.rotation.z += delta;
            break;
        }
        
        const degrees = Math.round((delta * 180 / Math.PI));
        const currentDegrees = Math.round((this.selectedObject.rotation[this.rotationAxis] * 180 / Math.PI));
        this.showStatus(`${this.rotationAxis.toUpperCase()}: ${currentDegrees}° (scroll to adjust, click to confirm)`, 500);
        this.updateObjectList();
      }
    });
}
cycleScaleAxis() {
  if (!this.selectedObject) return;
  
  const axes = ['x', 'y', 'z', 'uniform'];
  const currentIndex = axes.indexOf(this.scaleAxis);
  this.scaleAxis = axes[(currentIndex + 1) % axes.length];
  
  this.setMode('scale');
  
  if (this.scaleAxis === 'uniform') {
    const currentScale = this.selectedObject.scale.x;
    this.showStatus(`Scaling uniformly: ${currentScale.toFixed(3)} (scroll to adjust)`, 2000);
  } else {
    const currentScale = this.selectedObject.scale[this.scaleAxis];
    this.showStatus(`Scaling on ${this.scaleAxis.toUpperCase()} axis: ${currentScale.toFixed(3)} (scroll to adjust)`, 2000);
  }
}
  toggleMode(mode) {
  if (this.currentMode === mode) {
    this.setMode('select');
    this.showStatus(`${mode.toUpperCase()} mode disabled`, 1000);
  } else {
    this.setMode(mode);
    this.showStatus(`${mode.toUpperCase()} mode enabled`, 1000);
  }
}
cycleRotationAxis() {
  if (!this.selectedObject) return;
  
  const axes = ['x', 'y', 'z'];
  const currentIndex = axes.indexOf(this.rotationAxis);
  this.rotationAxis = axes[(currentIndex + 1) % axes.length];
  
  this.setMode('rotate');
  const currentDegrees = Math.round((this.selectedObject.rotation[this.rotationAxis] * 180 / Math.PI));
  this.showStatus(`Rotating on ${this.rotationAxis.toUpperCase()} axis: ${currentDegrees}° (scroll to adjust)`, 2000);
}

handleRotateClick() {
  if (!this.selectedObject) return;
  
  // Click confirms the rotation and exits rotate mode
  this.setMode('select');
  const currentDegrees = Math.round((this.selectedObject.rotation[this.rotationAxis] * 180 / Math.PI));
  this.showStatus(`Rotation confirmed: ${this.rotationAxis.toUpperCase()} = ${currentDegrees}°`, 1500);
  this.updateObjectList();
}

handleScaleClick() {
  if (!this.selectedObject) return;
  
  this.setMode('select');
  
  if (this.scaleAxis === 'uniform') {
    const currentScale = this.selectedObject.scale.x;
    this.showStatus(`Uniform scale confirmed: ${currentScale.toFixed(3)}`, 1500);
  } else {
    const currentScale = this.selectedObject.scale[this.scaleAxis];
    this.showStatus(`${this.scaleAxis.toUpperCase()} scale confirmed: ${currentScale.toFixed(3)}`, 1500);
  }
  
  this.updateObjectList();
}
  setMode(mode) {
    this.currentMode = mode;
    
    const modeDisplay = document.getElementById('wb-mode-display');
    if (modeDisplay) {
      const modeText = {
        select: 'SELECT',
        place: 'PLACE',
        rotate: 'ROTATE',
        scale: 'SCALE',
        move: 'MOVE'
      };
      
      const modeColors = {
        select: 'rgb(194, 194, 194)',
        place: 'rgb(194, 194, 194)',
        rotate: 'rgb(194, 194, 194)',
        scale: 'rgb(194, 194, 194)',
        move: 'rgb(194, 194, 194)'
      };
      
      modeDisplay.textContent = `MODE: ${modeText[mode]}`;
      modeDisplay.style.background = modeColors[mode];
    }
    
    this.showStatus(`Mode: ${mode.toUpperCase()}`, 1000);
  }
  
  toggleBuilder() {
    this.isBuilderMode = !this.isBuilderMode;
    this.builderPanel.style.display = this.isBuilderMode ? 'block' : 'none';
    this.statusIndicator.style.display = this.isBuilderMode ? 'block' : 'none';
    
    if (this.isBuilderMode) {
      this.statusIndicator.textContent = 'WORLD BUILDER ACTIVE';
      this.setMode('select');
      this.updateModelList();
    } else {
      this.statusIndicator.textContent = '';
      this.clearSelection();
      this.rotationPanel.style.display = 'none';
    }
  }
  
  async handleFiles(files) {
    for (let file of files) {
      if (file.name.endsWith('.glb') || file.name.endsWith('.gltf')) {
        await this.loadModel(file);
      }
    }
    this.updateModelList();
  }
  
  async loadModel(file) {
    const url = URL.createObjectURL(file);
    const modelName = file.name.replace(/\.(glb|gltf)$/, '');
    
    try {
      const gltf = await new Promise((resolve, reject) => {
        this.loader.load(url, resolve, undefined, reject);
      });
      
      gltf.scene.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      
      this.availableModels.set(modelName, {
        scene: gltf.scene,
        originalFile: file,
        animations: gltf.animations || [],
        isCollisionShape: false
      });
      
      this.showStatus(`Loaded: ${modelName}`, 2000);
      
    } catch (error) {
      this.showStatus(`Failed: ${modelName}`, 3000);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  
  updateModelList() {
    const container = document.getElementById('wb-model-list');
    if (!container) return;
    
    if (this.availableModels.size === 0) {
      container.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">No models loaded</div>';
      return;
    }
    
    let html = '';
    Array.from(this.availableModels.entries()).forEach(([name, data], index) => {
      const isSelected = this.selectedModel === name;
      
      const isCollision = data.isCollisionShape;
      const bgColor = isSelected ? 
        (isCollision ? 'rgba(255,0,255,0.3)' : 'rgba(0,255,255,0.2)') : 
        (isCollision ? 'rgba(255,0,255,0.1)' : 'rgba(255,255,255,0.1)');
      const borderColor = isSelected ? 
        (isCollision ? '#ff00ff' : '#00ffff') : 
        'transparent';
      const icon = isCollision ? 'tag' : 'ld';
      
      html += `
        <div onclick="worldBuilder.selectModel('${name}')" style="
          padding: 8px; margin: 2px 0; background: ${bgColor};
          border-radius: 3px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;
          border: 1px solid ${borderColor};
        ">
          <span>${icon} <strong>${index + 1}.</strong> ${name}</span>
          <button onclick="event.stopPropagation(); worldBuilder.removeModel('${name}')" style="
            background: #ff4444; color: white; border: none; padding: 2px 6px; 
            border-radius: 2px; cursor: pointer; font-size: 10px;">✕</button>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }
    selectModel(modelName) {
    this.selectedModel = modelName;
    this.updateModelList();
    
    const modelData = this.availableModels.get(modelName);
    const type = modelData.isCollisionShape ? 'collision shape' : 'model';
    this.showStatus(`Selected: ${modelName} (${type})`, 1500);
  }
  
  selectModelByIndex(index) {
    const models = Array.from(this.availableModels.keys());
    if (index < models.length) {
      this.selectModel(models[index]);
    }
  }

// In worldBuilder.js - handleMoveClick method
handleMoveClick() {
  if (!this.selectedObject) {
    this.showStatus('No object selected to move', 2000);
    return;
  }
  
  // Get all possible intersectable objects (floor, collision boxes, placed models)
  const intersectableObjects = [];
  this.scene.children.forEach(child => {
    if (child.geometry && child.geometry.type === 'PlaneGeometry') {
      intersectableObjects.push(child);
    }
    if (child.userData && child.userData.type === 'collision') {
      intersectableObjects.push(child);
    }
  });
  
  // Add all placed objects and their meshes for intersection (except the selected object)
  const allPlacedObjects = [...this.placedObjects, ...this.placedCollisionBoxes];
  allPlacedObjects.forEach(obj => {
    if (obj !== this.selectedObject) {
      obj.traverse(child => {
        if (child.isMesh) {
          intersectableObjects.push(child);
        }
      });
    }
  });
  
  const intersects = this.raycaster.intersectObjects(intersectableObjects, true);
  
  if (intersects.length > 0) {
    // Move to the intersection point
    const intersectionPoint = intersects[0].point;
    this.selectedObject.position.copy(intersectionPoint);
    
    this.showStatus(`Moved to intersection (${intersectionPoint.x.toFixed(1)}, ${intersectionPoint.y.toFixed(1)}, ${intersectionPoint.z.toFixed(1)})`, 1500);
    this.updateObjectList();
  } else {
    // No intersection found - move 10m in front of camera
    const cameraDirection = new THREE.Vector3(0, 0, -1);
    cameraDirection.applyQuaternion(this.camera.quaternion);
    cameraDirection.normalize();
    
    const newPosition = new THREE.Vector3();
    newPosition.copy(this.camera.position);
    newPosition.add(cameraDirection.multiplyScalar(10));
    
    this.selectedObject.position.copy(newPosition);
    
    this.showStatus(`Moved 10m ahead (${newPosition.x.toFixed(1)}, ${newPosition.y.toFixed(1)}, ${newPosition.z.toFixed(1)})`, 1500);
    this.updateObjectList();
  }
}

  fineMoveObject(direction) {
    if (!this.selectedObject) return;
    
    const step = 0.1;
    
    switch (direction) {
      case 'ArrowUp':
        this.selectedObject.position.z -= step;
        break;
      case 'ArrowDown':
        this.selectedObject.position.z += step;
        break;
      case 'ArrowLeft':
        this.selectedObject.position.x -= step;
        break;
      case 'ArrowRight':
        this.selectedObject.position.x += step;
        break;
    }
    
    this.showStatus(`Fine move: ${this.selectedObject.position.x.toFixed(1)}, ${this.selectedObject.position.z.toFixed(1)}`, 500);
    this.updateObjectList();
  }
  
  removeModel(modelName) {
    if (modelName.startsWith('collision_')) {
      this.showStatus('Cannot remove built-in collision shapes', 2000);
      return;
    }
    
    this.availableModels.delete(modelName);
    if (this.selectedModel === modelName) {
      this.selectedModel = null;
    }
    this.updateModelList();
    this.showStatus(`Removed: ${modelName}`, 1500);
  }
  
// In worldBuilder.js - handleWorldClick method
handleWorldClick(e) {
  this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  this.raycaster.setFromCamera(this.mouse, this.camera);
  
  if (this.currentMode === 'select') {
    this.handleSelectClick();
  } else if (this.currentMode === 'place') {
    this.handlePlaceClick();
  } else if (this.currentMode === 'move') {
    this.handleMoveClick();
  } else if (this.currentMode === 'scale') {
    this.handleScaleClick();
  } else if (this.currentMode === 'rotate') {
    this.handleRotateClick();
  }
}
  
  handleSelectClick() {
    const allPlacedObjects = [...this.placedObjects, ...this.placedCollisionBoxes];
    const placedMeshes = [];
    
    allPlacedObjects.forEach(obj => {
      obj.traverse(child => {
        if (child.isMesh) {
          child.userData.parentObject = obj;
          placedMeshes.push(child);
        }
      });
    });
    
    const intersects = this.raycaster.intersectObjects(placedMeshes);
    
    if (intersects.length > 0) {
      let targetObject = intersects[0].object;
      while (targetObject.parent && targetObject.userData.type !== 'world-builder-object') {
        targetObject = targetObject.parent;
      }
      if (targetObject.userData.type === 'world-builder-object') {
        this.selectObject(targetObject);
        return;
      }
    }
    this.clearSelection();
  }
  
// In worldBuilder.js - handlePlaceClick method
handlePlaceClick() {
  if (!this.selectedModel) {
    this.showStatus('Select a model first (click in library)', 2000);
    return;
  }
  
  // Get all possible intersectable objects (floor, collision boxes, placed models)
  const intersectableObjects = [];
  this.scene.children.forEach(child => {
    if (child.geometry && child.geometry.type === 'PlaneGeometry') {
      intersectableObjects.push(child);
    }
    if (child.userData && child.userData.type === 'collision') {
      intersectableObjects.push(child);
    }
  });
  
  // Add all placed objects and their meshes for intersection
  const allPlacedObjects = [...this.placedObjects, ...this.placedCollisionBoxes];
  allPlacedObjects.forEach(obj => {
    obj.traverse(child => {
      if (child.isMesh) {
        intersectableObjects.push(child);
      }
    });
  });
  
  const intersects = this.raycaster.intersectObjects(intersectableObjects, true);
  
  if (intersects.length > 0) {
    // Place at the intersection point
    const intersectionPoint = intersects[0].point;
    this.placeModel(intersectionPoint);
    this.showStatus(`Placed at intersection (${intersectionPoint.x.toFixed(1)}, ${intersectionPoint.y.toFixed(1)}, ${intersectionPoint.z.toFixed(1)})`, 2000);
  } else {
    // No intersection found - place 10m in front of camera
    const cameraDirection = new THREE.Vector3(0, 0, -1);
    cameraDirection.applyQuaternion(this.camera.quaternion);
    cameraDirection.normalize();
    
    const placementPosition = new THREE.Vector3();
    placementPosition.copy(this.camera.position);
    placementPosition.add(cameraDirection.multiplyScalar(10));
    
    this.placeModel(placementPosition);
    this.showStatus(`Placed 10m ahead (${placementPosition.x.toFixed(1)}, ${placementPosition.y.toFixed(1)}, ${placementPosition.z.toFixed(1)})`, 2000);
  }
}
// In worldBuilder.js - placeModel method
placeModel(position) {
  if (!this.selectedModel || !this.availableModels.has(this.selectedModel)) return;
  
  const modelData = this.availableModels.get(this.selectedModel);
  const modelClone = modelData.scene.clone();
  modelClone.position.copy(position);
  // Remove the Math.max constraint - allow placement anywhere in 3D space
  
  const uniqueId = Date.now() + Math.random();
  const instanceName = `${this.selectedModel}_${uniqueId}`;
  
  modelClone.userData = {
    type: 'world-builder-object',
    modelName: this.selectedModel,
    instanceId: uniqueId,
    instanceName: instanceName,
    id: uniqueId,
    created: new Date().toISOString(),
    isCollisionShape: modelData.isCollisionShape || false,
    shapeType: modelData.shapeType || null
  };
  
  this.scene.add(modelClone);
  
  if (modelData.isCollisionShape) {
    this.placedCollisionBoxes.push(modelClone);
    this.showStatus(`Placed collision: ${this.selectedModel}`, 1500);
  } else {
    this.placedObjects.push(modelClone);
    
    // Register collision IMMEDIATELY for non-collision-shape models
    if (window.meshCollisionSystem && !this.selectedModel.startsWith('collision_')) {
      // Force update the model's matrix first
      modelClone.updateMatrixWorld(true);
      
      // Register collision immediately
      window.meshCollisionSystem.registerModelCollision(instanceName, modelClone);
      console.log(`Registered collision for placed model: ${instanceName}`);
    }
    
    this.showStatus(`Placed: ${this.selectedModel}`, 1500);
  }
  this.selectObject(modelClone);
  this.updateObjectList();
}
  
  selectObject(object) {
    if (this.selectedObject) {
      this.removeSelectionHighlight(this.selectedObject);
    }
    
    this.selectedObject = object;
    if (object) {
      this.addSelectionHighlight(object);
      
      const type = object.userData.isCollisionShape ? 'collision' : 'object';
      this.showStatus(`Selected: ${object.userData.modelName} (${type})`, 1500);
    }
    this.updateObjectList();
  }
  
  addSelectionHighlight(object) {
    object.traverse(child => {
      if (child.isMesh && child.material) {
        const wireframe = new THREE.WireframeGeometry(child.geometry);
        const line = new THREE.LineSegments(wireframe, new THREE.LineBasicMaterial({ color: 0x00ffff }));
        line.name = 'selection-highlight';
        child.add(line);
      }
    });
  }
  
  removeSelectionHighlight(object) {
    object.traverse(child => {
      const highlight = child.getObjectByName('selection-highlight');
      if (highlight) {
        child.remove(highlight);
      }
    });
  }
  
  clearSelection() {
    if (this.selectedObject) {
      this.removeSelectionHighlight(this.selectedObject);
      this.selectedObject = null;
    }
    this.updateObjectList();
  }
  
  openRotationPanel() {
    if (!this.selectedObject) return;
    
    const rotation = this.selectedObject.rotation;
    const xDeg = Math.round(rotation.x * 180 / Math.PI);
    const yDeg = Math.round(rotation.y * 180 / Math.PI);
    const zDeg = Math.round(rotation.z * 180 / Math.PI);
    document.getElementById('wb-rot-x').value = xDeg;
    document.getElementById('wb-rot-y').value = yDeg;
    document.getElementById('wb-rot-z').value = zDeg;
    document.getElementById('wb-rot-x-num').value = xDeg;
    document.getElementById('wb-rot-y-num').value = yDeg;
    document.getElementById('wb-rot-z-num').value = zDeg;
    
    this.rotationPanel.style.display = 'block';
  }
  
  deleteSelected() {
    if (!this.selectedObject) return;
    
    const modelName = this.selectedObject.userData.modelName;
    const isCollision = this.selectedObject.userData.isCollisionShape;
    
    this.scene.remove(this.selectedObject);
    
    if (isCollision) {
      this.placedCollisionBoxes = this.placedCollisionBoxes.filter(obj => obj !== this.selectedObject);
      this.showStatus(`Deleted collision: ${modelName}`, 1500);
    } else {
      this.placedObjects = this.placedObjects.filter(obj => obj !== this.selectedObject);
      
      // Unregister collision for deleted model
      if (window.meshCollisionSystem && this.selectedObject.userData.instanceName) {
        window.meshCollisionSystem.unregisterModelCollision(this.selectedObject.userData.instanceName);
        console.log(`Unregistered collision for deleted model: ${this.selectedObject.userData.instanceName}`);
      }
      
      this.showStatus(`Deleted: ${modelName}`, 1500);
    }
    
    this.selectedObject = null;
    this.updateObjectList();
  }
  
  duplicateSelected() {
    if (!this.selectedObject) return;
    
    const original = this.selectedObject;
    const modelData = this.availableModels.get(original.userData.modelName);
    if (!modelData) return;
    
    const duplicate = modelData.scene.clone();
    duplicate.position.copy(original.position);
    duplicate.position.x += 2;
    duplicate.position.z += 2;
    duplicate.rotation.copy(original.rotation);
    duplicate.scale.copy(original.scale);
    
    duplicate.userData = {
      type: 'world-builder-object',
      modelName: original.userData.modelName,
      id: Date.now() + Math.random(),
      created: new Date().toISOString(),
      isCollisionShape: original.userData.isCollisionShape || false,
      shapeType: original.userData.shapeType || null
    };
    
    this.scene.add(duplicate);
    
    if (original.userData.isCollisionShape) {
      this.placedCollisionBoxes.push(duplicate);
      this.showStatus(`Duplicated collision: ${original.userData.modelName}`, 1500);
    } else {
      this.placedObjects.push(duplicate);
      this.showStatus(`Duplicated: ${original.userData.modelName}`, 1500);
    }
    
    this.selectObject(duplicate);
    this.updateObjectList();
  }
    updateObjectList() {
    const container = document.getElementById('wb-object-list');
    const countElement = document.getElementById('wb-object-count');
    
    if (!container || !countElement) return;
    
    const allObjects = [...this.placedObjects, ...this.placedCollisionBoxes];
    countElement.textContent = allObjects.length;
    
    if (allObjects.length === 0) {
      container.innerHTML = '<div style="color: #888; text-align: center; padding: 10px;">No objects placed</div>';
      return;
    }
    
    const modelCounts = {};
    allObjects.forEach(obj => {
      const modelName = obj.userData.modelName;
      if (!modelCounts[modelName]) {
        modelCounts[modelName] = { count: 0, objects: [], isCollision: obj.userData.isCollisionShape };
      }
      modelCounts[modelName].count++;
      modelCounts[modelName].objects.push(obj);
    });
    
    let html = '';
    Object.entries(modelCounts).forEach(([modelName, data]) => {
      const icon = data.isCollision ? 'rg' : 'ld';
      const bgColor = data.isCollision ? 'rgba(255,0,255,0.05)' : 'rgba(255,255,255,0.05)';
      
      html += `
        <div style="
          padding: 4px; margin: 1px 0; background: ${bgColor};
          border-radius: 2px; font-size: 9px; border: 1px solid transparent;
        ">
          <strong>${icon} ${modelName}</strong> 
          <span style="color: #ffff00;">(${data.count}x)</span><br>
          <span style="color: #888; font-size: 8px;">Click objects individually to select</span>
        </div>
      `;
    });
    
    container.innerHTML = html;
  }
  
  selectObjectByIndex(index) {
    const allObjects = [...this.placedObjects, ...this.placedCollisionBoxes];
    if (index < allObjects.length) {
      this.selectObject(allObjects[index]);
    }
  }
  
  saveWorld() {
    const allObjects = [...this.placedObjects, ...this.placedCollisionBoxes];
    
    const worldData = {
      version: '1.0',
      created: new Date().toISOString(),
      objects: allObjects.map(obj => ({
        modelName: obj.userData.modelName,
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
        userData: obj.userData
      }))
    };
    
    localStorage.setItem('world-builder-save', JSON.stringify(worldData));
    
    const blob = new Blob([JSON.stringify(worldData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `world-save-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    this.showStatus(`World saved (${allObjects.length} objects)`, 2000);
  }
  
async loadWorld() {
  const stored = localStorage.getItem('world-builder-save');
  if (!stored) {
    this.showStatus('No saved world found', 2000);
    return;
  }
  
  try {
    const worldData = JSON.parse(stored);
    
    // Clear existing objects
    this.placedObjects.forEach(obj => this.scene.remove(obj));
    this.placedCollisionBoxes.forEach(box => this.scene.remove(box));
    this.placedObjects = [];
    this.placedCollisionBoxes = [];
    this.clearSelection();
    
    for (const objData of worldData.objects) {
      if (this.availableModels.has(objData.modelName)) {
        const modelData = this.availableModels.get(objData.modelName);
        const obj = modelData.scene.clone();
        
        // Apply saved transform data
        obj.position.set(objData.position.x, objData.position.y, objData.position.z);
        obj.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z);
        obj.scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
        
        // IMPORTANT: Set up proper userData for World Builder manipulation
        obj.userData = {
          ...objData.userData,
          type: 'world-builder-object', // This is crucial!
          modelName: objData.modelName,
          instanceId: objData.instanceId || (Date.now() + Math.random()),
          created: objData.userData.created || new Date().toISOString(),
          isCollisionShape: modelData.isCollisionShape || objData.userData.isCollisionShape || false,
          shapeType: modelData.shapeType || objData.userData.shapeType || null
        };
        
        this.scene.add(obj);
        
        // Add to the correct tracking arrays
        if (modelData.isCollisionShape || objData.userData.isCollisionShape) {
          this.placedCollisionBoxes.push(obj);
        } else {
          this.placedObjects.push(obj);
        }
      }
    }
    
    this.updateObjectList();
    this.showStatus(`Loaded ${worldData.objects.length} objects`, 2000);
    
  } catch (error) {
    console.error('Failed to load world:', error);
    this.showStatus('Failed to load world', 2000);
  }
}
  
  loadWorldConfig() {
    const stored = localStorage.getItem('world-builder-save');
    if (stored) {
      console.log('Found saved world data');
    }
  }
  
  setupAutoSave() {
    setInterval(() => {
      const allObjects = [...this.placedObjects, ...this.placedCollisionBoxes];
      if (allObjects.length > 0) {
        const worldData = {
          version: '1.0',
          created: new Date().toISOString(),
          objects: allObjects.map(obj => ({
            modelName: obj.userData.modelName,
            position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
            rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
            scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
            userData: obj.userData
          }))
        };
        localStorage.setItem('world-builder-autosave', JSON.stringify(worldData));
      }
    }, 5 * 60 * 1000); 
  }
  
  showStatus(message, duration = 2000) {
    this.statusIndicator.textContent = message;
    this.statusIndicator.style.display = 'block';
    
    setTimeout(() => {
      if (this.isBuilderMode) {
        this.statusIndicator.textContent = 'WORLD BUILDER ACTIVE';
      } else {
        this.statusIndicator.style.display = 'none';
      }
    }, duration);
  }
  
  destroy() {
    this.placedObjects.forEach(obj => this.scene.remove(obj));
    this.placedCollisionBoxes.forEach(box => this.scene.remove(box));
    this.builderPanel.remove();
    this.rotationPanel.remove();
    this.statusIndicator.remove();
    this.clearSelection();
  }
}

export { WorldBuilder };