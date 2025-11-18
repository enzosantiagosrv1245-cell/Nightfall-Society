const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

// Inicializa banco de dados
const db = new Database(path.join(__dirname, 'nightfall.db'));
db.pragma('journal_mode = WAL'); // Performance

// Criação de tabelas
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS players (
    user_id INTEGER PRIMARY KEY,
    x REAL DEFAULT 400,
    y REAL DEFAULT 300,
    hp INTEGER DEFAULT 100,
    gems INTEGER DEFAULT 0,
    rank TEXT DEFAULT 'Cidadão',
    rank_color TEXT DEFAULT '#808080',
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    zombies_killed INTEGER DEFAULT 0,
    players_saved INTEGER DEFAULT 0,
    inventory TEXT DEFAULT '[]',
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS treasury (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    balance INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    options TEXT NOT NULL,
    votes TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ends_at DATETIME NOT NULL,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    channel TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO treasury (id, balance) VALUES (1, 0);
`);

// Prepared statements para performance
const stmts = {
  // Usuários
  createUser: db.prepare('INSERT INTO users (username, password) VALUES (?, ?)'),
  getUser: db.prepare('SELECT * FROM users WHERE username = ?'),
  
  // Players
  createPlayer: db.prepare(`
    INSERT INTO players (user_id) VALUES (?)
  `),
  getPlayer: db.prepare('SELECT * FROM players WHERE user_id = ?'),
  updatePlayer: db.prepare(`
    UPDATE players 
    SET x = ?, y = ?, hp = ?, gems = ?, rank = ?, rank_color = ?, 
        level = ?, xp = ?, zombies_killed = ?, players_saved = ?, inventory = ?
    WHERE user_id = ?
  `),
  getAllPlayers: db.prepare('SELECT p.*, u.username FROM players p JOIN users u ON p.user_id = u.id'),
  
  // Propriedades
  addProperty: db.prepare('INSERT INTO properties (owner_id, type, x, y, width, height) VALUES (?, ?, ?, ?, ?, ?)'),
  getProperties: db.prepare('SELECT * FROM properties WHERE owner_id = ?'),
  getAllProperties: db.prepare('SELECT * FROM properties'),
  
  // Tesouro
  getTreasury: db.prepare('SELECT balance FROM treasury WHERE id = 1'),
  updateTreasury: db.prepare('UPDATE treasury SET balance = ?, last_updated = CURRENT_TIMESTAMP WHERE id = 1'),
  
  // Votos
  createVote: db.prepare('INSERT INTO votes (type, description, options, ends_at) VALUES (?, ?, ?, ?)'),
  getActiveVotes: db.prepare("SELECT * FROM votes WHERE active = 1 AND ends_at > datetime('now')"),
  updateVoteData: db.prepare('UPDATE votes SET votes = ? WHERE id = ?'),
  closeVote: db.prepare('UPDATE votes SET active = 0 WHERE id = ?'),
  
  // Chat
  addChatMessage: db.prepare('INSERT INTO chat_history (username, channel, message) VALUES (?, ?, ?)'),
  getChatHistory: db.prepare('SELECT * FROM chat_history WHERE channel = ? ORDER BY id DESC LIMIT 100')
};

// Funções exportadas
module.exports = {
  // Autenticação
  async registerUser(username, password) {
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = stmts.createUser.run(username, hashedPassword);
      stmts.createPlayer.run(result.lastInsertRowid);
      return { success: true, userId: result.lastInsertRowid };
    } catch (error) {
      return { success: false, error: 'Username já existe' };
    }
  },

  async loginUser(username, password) {
    const user = stmts.getUser.get(username);
    if (!user) return { success: false, error: 'Usuário não encontrado' };
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) return { success: false, error: 'Senha incorreta' };
    
    const player = stmts.getPlayer.get(user.id);
    return { 
      success: true, 
      userId: user.id, 
      username: user.username,
      player: {
        ...player,
        inventory: JSON.parse(player.inventory)
      }
    };
  },

  // Player data
  getPlayerData(userId) {
    const player = stmts.getPlayer.get(userId);
    if (!player) return null;
    return {
      ...player,
      inventory: JSON.parse(player.inventory)
    };
  },

  savePlayerData(userId, data) {
    stmts.updatePlayer.run(
      data.x, data.y, data.hp, data.gems, data.rank, data.rank_color,
      data.level, data.xp, data.zombies_killed, data.players_saved,
      JSON.stringify(data.inventory),
      userId
    );
  },

  getAllPlayersData() {
    const players = stmts.getAllPlayers.all();
    return players.map(p => ({
      ...p,
      inventory: JSON.parse(p.inventory)
    }));
  },

  // Propriedades
  addProperty(ownerId, type, x, y, width, height) {
    stmts.addProperty.run(ownerId, type, x, y, width, height);
  },

  getPlayerProperties(ownerId) {
    return stmts.getProperties.all(ownerId);
  },

  getAllProperties() {
    return stmts.getAllProperties.all();
  },

  // Tesouro
  getTreasuryBalance() {
    return stmts.getTreasury.get().balance;
  },

  updateTreasuryBalance(amount) {
    const current = this.getTreasuryBalance();
    stmts.updateTreasury.run(current + amount);
  },

  // Votos
  createVote(type, description, options, durationHours = 24) {
    const endsAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
    stmts.createVote.run(type, description, JSON.stringify(options), endsAt);
  },

  getActiveVotes() {
    const votes = stmts.getActiveVotes.all();
    return votes.map(v => ({
      ...v,
      options: JSON.parse(v.options),
      votes: JSON.parse(v.votes)
    }));
  },

  castVote(voteId, userId, option) {
    const votes = stmts.getActiveVotes.all().find(v => v.id === voteId);
    if (!votes) return false;
    
    const voteData = JSON.parse(votes.votes);
    voteData[userId] = option;
    stmts.updateVoteData.run(JSON.stringify(voteData), voteId);
    return true;
  },

  closeVote(voteId) {
    stmts.closeVote.run(voteId);
  },

  // Chat
  addChatMessage(username, channel, message) {
    stmts.addChatMessage.run(username, channel, message);
  },

  getChatHistory(channel = 'geral') {
    return stmts.getChatHistory.all(channel).reverse();
  },

  // Cleanup
  close() {
    db.close();
  }
};