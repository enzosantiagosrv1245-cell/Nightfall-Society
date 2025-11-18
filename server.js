const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const db = require('./database');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Estado do jogo
const gameState = {
  players: new Map(), // socketId -> playerData
  zombies: [],
  sharks: [],
  timeOfDay: 'day', // 'day', 'dusk', 'night'
  dayTimer: 0,
  cycle: 0
};

// Constantes
const CYCLE_TIMES = {
  day: 600000,    // 10 minutos
  dusk: 60000,    // 1 minuto
  night: 240000   // 4 minutos
};

const RANKS = {
  'Cidadão': { color: '#808080', level: 1 },
  'Trabalhador': { color: '#8B4513', level: 2 },
  'Comerciante': { color: '#2ECC71', level: 3 },
  'Guarda': { color: '#3498DB', level: 4 },
  'Conselheiro': { color: '#9B59B6', level: 5 },
  'Líder': { color: '#FFD700', level: 6 },
  'Guardião Celestial': { color: '#FFFFFF', level: 7, special: 'angel' },
  'Executor das Sombras': { color: '#1a0000', level: 7, special: 'shadow' }
};

// Ciclo dia/noite
let cycleInterval;
function startDayCycle() {
  let currentPhase = 'day';
  let phaseStart = Date.now();
  
  cycleInterval = setInterval(() => {
    const elapsed = Date.now() - phaseStart;
    
    if (currentPhase === 'day' && elapsed >= CYCLE_TIMES.day) {
      currentPhase = 'dusk';
      phaseStart = Date.now();
      gameState.timeOfDay = 'dusk';
      io.emit('phaseChange', { phase: 'dusk', message: '⚠️ NOITE SE APROXIMA! Prepare-se!' });
      
    } else if (currentPhase === 'dusk' && elapsed >= CYCLE_TIMES.dusk) {
      currentPhase = 'night';
      phaseStart = Date.now();
      gameState.timeOfDay = 'night';
      gameState.cycle++;
      spawnZombieWave(1);
      io.emit('phaseChange', { phase: 'night', message: '🌙 NOITE CAIU! Zumbis atacam!' });
      
    } else if (currentPhase === 'night' && elapsed >= CYCLE_TIMES.night) {
      currentPhase = 'day';
      phaseStart = Date.now();
      gameState.timeOfDay = 'day';
      gameState.zombies = [];
      rewardSurvivors();
      io.emit('phaseChange', { phase: 'day', message: '☀️ Dia chegou! Você sobreviveu!' });
    }
    
    // Spawn ondas durante a noite
    if (currentPhase === 'night') {
      const nightMinute = Math.floor(elapsed / 60000);
      if (nightMinute === 1 && !gameState.wave2Spawned) {
        spawnZombieWave(2);
        gameState.wave2Spawned = true;
      } else if (nightMinute === 2 && !gameState.wave3Spawned) {
        spawnZombieWave(3);
        gameState.wave3Spawned = true;
      } else if (nightMinute === 3 && !gameState.wave4Spawned) {
        spawnZombieWave(4);
        gameState.wave4Spawned = true;
      }
    } else {
      gameState.wave2Spawned = false;
      gameState.wave3Spawned = false;
      gameState.wave4Spawned = false;
    }
  }, 1000);
}

// Spawn de zumbis
function spawnZombieWave(wave) {
  const configs = {
    1: { common: 10, fast: 0, tank: 0 },
    2: { common: 12, fast: 3, tank: 0 },
    3: { common: 10, fast: 7, tank: 3 },
    4: { common: 15, fast: 7, tank: 3 }
  };
  
  const config = configs[wave];
  
  for (let i = 0; i < config.common; i++) {
    spawnZombie('common');
  }
  for (let i = 0; i < config.fast; i++) {
    spawnZombie('fast');
  }
  for (let i = 0; i < config.tank; i++) {
    spawnZombie('tank');
  }
}

function spawnZombie(type) {
  const specs = {
    common: { hp: 30, speed: 50, damage: 5, gems: 10 },
    fast: { hp: 20, speed: 100, damage: 8, gems: 17 },
    tank: { hp: 100, speed: 30, damage: 15, gems: 50 }
  };
  
  const spec = specs[type];
  const side = Math.floor(Math.random() * 4); // 0=top, 1=right, 2=bottom, 3=left
  let x, y;
  
  switch(side) {
    case 0: x = Math.random() * 1600; y = -50; break;
    case 1: x = 1650; y = Math.random() * 1200; break;
    case 2: x = Math.random() * 1600; y = 1250; break;
    case 3: x = -50; y = Math.random() * 1200; break;
  }
  
  gameState.zombies.push({
    id: uuidv4(),
    type,
    x,
    y,
    hp: spec.hp,
    maxHp: spec.hp,
    speed: spec.speed,
    damage: spec.damage,
    gems: spec.gems,
    target: null
  });
}

// Spawn de tubarões
function spawnSharks() {
  setInterval(() => {
    if (gameState.sharks.length < 5) {
      gameState.sharks.push({
        id: uuidv4(),
        x: Math.random() * 400 + 1200, // Mar à direita
        y: Math.random() * 1200,
        hp: 50,
        maxHp: 50,
        speed: 60,
        damage: 20,
        gems: 30,
        target: null
      });
    }
  }, 30000); // Novo tubarão a cada 30s
}

// Recompensar sobreviventes
function rewardSurvivors() {
  gameState.players.forEach((player, socketId) => {
    if (player.hp > 0) {
      player.gems += 50;
      io.to(socketId).emit('notification', { 
        type: 'success', 
        message: '🎉 Você sobreviveu! +50 Gems' 
      });
    }
  });
}

// Update de IA (zumbis e tubarões)
setInterval(() => {
  // Atualizar zumbis
  gameState.zombies.forEach(zombie => {
    // Encontrar player mais próximo
    let closestPlayer = null;
    let closestDist = Infinity;
    
    gameState.players.forEach(player => {
      if (player.hp <= 0) return;
      const dist = Math.hypot(player.x - zombie.x, player.y - zombie.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestPlayer = player;
      }
    });
    
    if (closestPlayer) {
      const angle = Math.atan2(closestPlayer.y - zombie.y, closestPlayer.x - zombie.x);
      zombie.x += Math.cos(angle) * (zombie.speed / 60);
      zombie.y += Math.sin(angle) * (zombie.speed / 60);
      zombie.target = closestPlayer.socketId;
      
      // Ataque se próximo
      if (closestDist < 30) {
        closestPlayer.hp = Math.max(0, closestPlayer.hp - zombie.damage / 60);
      }
    }
  });
  
  // Atualizar tubarões
  gameState.sharks.forEach(shark => {
    // Movimento aleatório no mar
    if (!shark.target) {
      shark.x += (Math.random() - 0.5) * 2;
      shark.y += (Math.random() - 0.5) * 2;
      shark.x = Math.max(1200, Math.min(1600, shark.x));
      shark.y = Math.max(0, Math.min(1200, shark.y));
    }
    
    // Atacar players no mar
    gameState.players.forEach(player => {
      if (player.hp <= 0 || player.x < 1200) return;
      const dist = Math.hypot(player.x - shark.x, player.y - shark.y);
      if (dist < 100) {
        const angle = Math.atan2(player.y - shark.y, player.x - shark.x);
        shark.x += Math.cos(angle) * (shark.speed / 60);
        shark.y += Math.sin(angle) * (shark.speed / 60);
        shark.target = player.socketId;
        
        if (dist < 30) {
          player.hp = Math.max(0, player.hp - shark.damage / 60);
        }
      }
    });
  });
  
  // Broadcast estado
  io.emit('gameState', {
    players: Array.from(gameState.players.values()),
    zombies: gameState.zombies,
    sharks: gameState.sharks,
    timeOfDay: gameState.timeOfDay
  });
}, 1000 / 60); // 60 FPS

// WebSocket
io.on('connection', (socket) => {
  console.log('Player conectado:', socket.id);
  
  socket.on('register', async (data) => {
    const result = await db.registerUser(data.username, data.password);
    socket.emit('registerResult', result);
  });
  
  socket.on('login', async (data) => {
    const result = await db.loginUser(data.username, data.password);
    if (result.success) {
      gameState.players.set(socket.id, {
        ...result.player,
        socketId: socket.id,
        username: result.username
      });
      
      socket.emit('loginResult', { 
        success: true, 
        player: result.player,
        username: result.username 
      });
      
      // Enviar histórico de chat
      const history = db.getChatHistory('geral');
      socket.emit('chatHistory', history);
    } else {
      socket.emit('loginResult', result);
    }
  });
  
  socket.on('move', (data) => {
    const player = gameState.players.get(socket.id);
    if (player && player.hp > 0) {
      player.x = Math.max(0, Math.min(1600, data.x));
      player.y = Math.max(0, Math.min(1200, data.y));
    }
  });
  
  socket.on('attack', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player || player.hp <= 0) return;
    
    // Atacar zumbis
    gameState.zombies = gameState.zombies.filter(zombie => {
      const dist = Math.hypot(zombie.x - data.targetX, zombie.y - data.targetY);
      if (dist < 30) {
        zombie.hp -= data.damage;
        if (zombie.hp <= 0) {
          player.gems += zombie.gems;
          player.zombies_killed++;
          checkRankUp(player);
          return false;
        }
      }
      return true;
    });
    
    // Atacar tubarões
    gameState.sharks = gameState.sharks.filter(shark => {
      const dist = Math.hypot(shark.x - data.targetX, shark.y - data.targetY);
      if (dist < 30) {
        shark.hp -= data.damage;
        if (shark.hp <= 0) {
          player.gems += shark.gems;
          return false;
        }
      }
      return true;
    });
  });
  
  socket.on('chat', (data) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    
    db.addChatMessage(player.username, data.channel, data.message);
    io.emit('chatMessage', {
      username: player.username,
      channel: data.channel,
      message: data.message,
      rank: player.rank,
      rankColor: player.rank_color,
      timestamp: new Date().toISOString()
    });
  });
  
  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      db.savePlayerData(player.user_id, player);
      gameState.players.delete(socket.id);
    }
    console.log('Player desconectado:', socket.id);
  });
});

// Salvar dados periodicamente
setInterval(() => {
  gameState.players.forEach(player => {
    if (player.user_id) {
      db.savePlayerData(player.user_id, player);
    }
  });
}, 30000); // A cada 30s

// Verificar rank up
function checkRankUp(player) {
  if (player.zombies_killed >= 200 && player.rank !== 'Executor das Sombras') {
    player.rank = 'Executor das Sombras';
    player.rank_color = '#1a0000';
    io.to(player.socketId).emit('notification', {
      type: 'legendary',
      message: '⚔️ VOCÊ SE TORNOU UM EXECUTOR DAS SOMBRAS!'
    });
  } else if (player.players_saved >= 50 && player.rank !== 'Guardião Celestial') {
    player.rank = 'Guardião Celestial';
    player.rank_color = '#FFFFFF';
    io.to(player.socketId).emit('notification', {
      type: 'legendary',
      message: '😇 VOCÊ SE TORNOU UM GUARDIÃO CELESTIAL!'
    });
  }
}

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`🎮 Nightfall Society rodando na porta ${PORT}`);
  startDayCycle();
  spawnSharks();
});

// Cleanup
process.on('SIGINT', () => {
  clearInterval(cycleInterval);
  gameState.players.forEach(player => {
    if (player.user_id) {
      db.savePlayerData(player.user_id, player);
    }
  });
  db.close();
  process.exit();
});