// Conexão WebSocket
const socket = io();

// Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Estado do cliente
let localPlayer = null;
let gameState = {
  players: [],
  zombies: [],
  sharks: [],
  timeOfDay: 'day'
};
let camera = { x: 0, y: 0 };
let keys = {};
let mousePos = { x: 0, y: 0 };
let currentChannel = 'geral';

// Sprites
const sprites = {};
const spriteList = [
  'Human', 'Zombie', 'Gem', 'Grass', 'Sea', 'Street', 
  'Shark', 'Box', 'smallBed', 'bigtable', 'garagefloor',
  'Bow', 'Arrow', 'Blowdart', 'Antidote', 'AngelWings'
];

let spritesLoaded = 0;
spriteList.forEach(name => {
  const img = new Image();
  img.src = `/Sprites/${name}.png`;
  img.onload = () => {
    spritesLoaded++;
    if (spritesLoaded === spriteList.length) {
      console.log('✅ Todos os sprites carregados');
    }
  };
  sprites[name] = img;
});

// Login/Registro
document.getElementById('loginBtn').addEventListener('click', () => {
  const username = document.getElementById('usernameInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  
  if (!username || !password) {
    showError('Preencha todos os campos');
    return;
  }
  
  socket.emit('login', { username, password });
});

document.getElementById('registerBtn').addEventListener('click', () => {
  const username = document.getElementById('usernameInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  
  if (!username || !password) {
    showError('Preencha todos os campos');
    return;
  }
  
  if (username.length < 3) {
    showError('Usuário deve ter no mínimo 3 caracteres');
    return;
  }
  
  if (password.length < 6) {
    showError('Senha deve ter no mínimo 6 caracteres');
    return;
  }
  
  socket.emit('register', { username, password });
});

socket.on('registerResult', (result) => {
  if (result.success) {
    showError('Conta criada! Faça login.', 'success');
  } else {
    showError(result.error);
  }
});

socket.on('loginResult', (result) => {
  if (result.success) {
    localPlayer = {
      ...result.player,
      username: result.username
    };
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('gameContainer').style.display = 'block';
    updateHUD();
    startGame();
  } else {
    showError(result.error);
  }
});

function showError(msg, type = 'error') {
  const errorDiv = document.getElementById('errorMsg');
  errorDiv.textContent = msg;
  errorDiv.style.color = type === 'success' ? '#2ECC71' : '#E74C3C';
}

// Input
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  
  // Atalhos
  if (e.key === 'Enter') {
    document.getElementById('chatMessageInput').focus();
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mousePos.x = e.clientX - rect.left + camera.x;
  mousePos.y = e.clientY - rect.top + camera.y;
});

canvas.addEventListener('click', (e) => {
  if (!localPlayer || localPlayer.hp <= 0) return;
  
  // Atacar com arma equipada
  const weapon = localPlayer.inventory.find(item => item && item.equipped);
  if (!weapon) return;
  
  let damage = 0;
  if (weapon.type === 'bow') damage = 15;
  else if (weapon.type === 'blowdart') damage = 8;
  else if (weapon.type === 'sword') damage = 10;
  
  socket.emit('attack', {
    targetX: mousePos.x,
    targetY: mousePos.y,
    damage
  });
  
  // Animação de ataque (opcional)
  drawAttackEffect(mousePos.x, mousePos.y);
});

// Atualizar estado do jogo
socket.on('gameState', (state) => {
  gameState = state;
  
  // Atualizar dados do player local
  const serverPlayer = state.players.find(p => p.username === localPlayer?.username);
  if (serverPlayer) {
    localPlayer = { ...localPlayer, ...serverPlayer };
    updateHUD();
  }
});

socket.on('phaseChange', (data) => {
  const indicator = document.getElementById('phaseIndicator');
  const phases = {
    day: { text: '☀️ DIA', class: 'phase-day' },
    dusk: { text: '⚠️ CREPÚSCULO', class: 'phase-dusk' },
    night: { text: '🌙 NOITE', class: 'phase-night' }
  };
  
  const phase = phases[data.phase];
  indicator.textContent = phase.text;
  indicator.className = phase.class;
  
  showNotification(data.message, data.phase === 'night' ? 'warning' : 'success');
});

socket.on('notification', (data) => {
  showNotification(data.message, data.type);
});

// Loop do jogo
function startGame() {
  setInterval(() => {
    if (!localPlayer) return;
    
    // Movimento
    let dx = 0, dy = 0;
    const speed = 3;
    
    if (keys['w'] || keys['arrowup']) dy -= speed;
    if (keys['s'] || keys['arrowdown']) dy += speed;
    if (keys['a'] || keys['arrowleft']) dx -= speed;
    if (keys['d'] || keys['arrowright']) dx += speed;
    
    if (dx !== 0 || dy !== 0) {
      localPlayer.x += dx;
      localPlayer.y += dy;
      
      // Limites do mapa
      localPlayer.x = Math.max(0, Math.min(1600, localPlayer.x));
      localPlayer.y = Math.max(0, Math.min(1200, localPlayer.y));
      
      socket.emit('move', { x: localPlayer.x, y: localPlayer.y });
    }
    
    render();
  }, 1000 / 60);
}

// Renderização
function render() {
  if (!localPlayer) return;
  
  // Câmera segue player
  camera.x = localPlayer.x - canvas.width / 2;
  camera.y = localPlayer.y - canvas.height / 2;
  camera.x = Math.max(0, Math.min(1600 - canvas.width, camera.x));
  camera.y = Math.max(0, Math.min(1200 - canvas.height, camera.y));
  
  // Limpar tela
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Renderizar terreno
  renderTerrain();
  
  // Renderizar entidades
  renderSharks();
  renderZombies();
  renderPlayers();
  
  // Renderizar mira
  renderCrosshair();
  
  // Overlay de noite
  if (gameState.timeOfDay === 'night') {
    ctx.fillStyle = 'rgba(0, 0, 50, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function renderTerrain() {
  const tileSize = 64;
  
  for (let x = 0; x < 1600; x += tileSize) {
    for (let y = 0; y < 1200; y += tileSize) {
      const screenX = x - camera.x;
      const screenY = y - camera.y;
      
      if (screenX < -tileSize || screenX > canvas.width || 
          screenY < -tileSize || screenY > canvas.height) continue;
      
      // Mar à direita
      if (x >= 1200) {
        ctx.drawImage(sprites.Sea, screenX, screenY, tileSize, tileSize);
      }
      // Ruas na cidade (centro)
      else if (x >= 400 && x < 1000 && y >= 300 && y < 900) {
        ctx.drawImage(sprites.Street, screenX, screenY, tileSize, tileSize);
      }
      // Grama
      else {
        ctx.drawImage(sprites.Grass, screenX, screenY, tileSize, tileSize);
      }
    }
  }
}

function renderPlayers() {
  gameState.players.forEach(player => {
    const screenX = player.x - camera.x;
    const screenY = player.y - camera.y;
    
    if (screenX < -50 || screenX > canvas.width + 50 || 
        screenY < -50 || screenY > canvas.height + 50) return;
    
    // Sprite do player
    ctx.drawImage(sprites.Human, screenX - 16, screenY - 16, 32, 32);
    
    // Asas especiais
    if (player.rank === 'Guardião Celestial') {
      ctx.drawImage(sprites.AngelWings, screenX - 20, screenY - 30, 40, 40);
    } else if (player.rank === 'Executor das Sombras') {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(sprites.AngelWings, -screenX - 20, screenY - 30, 40, 40);
      ctx.restore();
    }
    
    // Nome e rank
    ctx.fillStyle = player.rank_color || '#808080';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(player.username, screenX, screenY - 25);
    
    // HP bar
    if (player.hp < 100) {
      const barWidth = 32;
      const barHeight = 4;
      ctx.fillStyle = '#000';
      ctx.fillRect(screenX - barWidth/2 - 1, screenY + 20, barWidth + 2, barHeight + 2);
      ctx.fillStyle = '#E74C3C';
      ctx.fillRect(screenX - barWidth/2, screenY + 21, barWidth * (player.hp / 100), barHeight);
    }
  });
}

function renderZombies() {
  gameState.zombies.forEach(zombie => {
    const screenX = zombie.x - camera.x;
    const screenY = zombie.y - camera.y;
    
    if (screenX < -50 || screenX > canvas.width + 50 || 
        screenY < -50 || screenY > canvas.height + 50) return;
    
    ctx.drawImage(sprites.Zombie, screenX - 16, screenY - 16, 32, 32);
    
    // HP bar
    const barWidth = 32;
    const barHeight = 4;
    ctx.fillStyle = '#000';
    ctx.fillRect(screenX - barWidth/2 - 1, screenY + 20, barWidth + 2, barHeight + 2);
    ctx.fillStyle = '#8B00FF';
    ctx.fillRect(screenX - barWidth/2, screenY + 21, barWidth * (zombie.hp / zombie.maxHp), barHeight);
  });
}

function renderSharks() {
  gameState.sharks.forEach(shark => {
    const screenX = shark.x - camera.x;
    const screenY = shark.y - camera.y;
    
    if (screenX < -50 || screenX > canvas.width + 50 || 
        screenY < -50 || screenY > canvas.height + 50) return;
    
    ctx.drawImage(sprites.Shark, screenX - 20, screenY - 16, 40, 32);
    
    // HP bar
    const barWidth = 40;
    const barHeight = 4;
    ctx.fillStyle = '#000';
    ctx.fillRect(screenX - barWidth/2 - 1, screenY + 20, barWidth + 2, barHeight + 2);
    ctx.fillStyle = '#3498DB';
    ctx.fillRect(screenX - barWidth/2, screenY + 21, barWidth * (shark.hp / shark.maxHp), barHeight);
  });
}

function renderCrosshair() {
  const x = mousePos.x - camera.x;
  const y = mousePos.y - camera.y;
  
  ctx.strokeStyle = '#E74C3C';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 10, y);
  ctx.lineTo(x + 10, y);
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x, y + 10);
  ctx.stroke();
}

function drawAttackEffect(x, y) {
  const screenX = x - camera.x;
  const screenY = y - camera.y;
  
  ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
  ctx.beginPath();
  ctx.arc(screenX, screenY, 20, 0, Math.PI * 2);
  ctx.fill();
  
  setTimeout(() => render(), 50);
}

// Atualizar HUD
function updateHUD() {
  if (!localPlayer) return;
  
  document.getElementById('playerName').textContent = localPlayer.username;
  document.getElementById('hpText').textContent = `${Math.floor(localPlayer.hp)}/100`;
  document.getElementById('hpBarFill').style.width = `${localPlayer.hp}%`;
  document.getElementById('gemsCount').textContent = localPlayer.gems;
  document.getElementById('playerRank').textContent = localPlayer.rank;
  document.getElementById('playerRank').style.color = localPlayer.rank_color;
  document.getElementById('zombiesKilled').textContent = localPlayer.zombies_killed;
}

// Notificações
function showNotification(message, type = 'success') {
  const container = document.getElementById('notifications');
  const notif = document.createElement('div');
  notif.className = `notification ${type}`;
  notif.textContent = message;
  container.appendChild(notif);
  
  setTimeout(() => {
    notif.style.opacity = '0';
    notif.style.transform = 'translateX(400px)';
    setTimeout(() => notif.remove(), 300);
  }, 5000);
}

// Redimensionar canvas
window.addEventListener('resize', () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});