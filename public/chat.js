// Sistema de Chat
let currentChannel = 'geral';

// Elementos DOM
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatMessageInput');
const sendBtn = document.getElementById('sendChatBtn');
const chatTabs = document.querySelectorAll('.chat-tab');

// Inicializar tabs
chatTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    // Remover active de todos
    chatTabs.forEach(t => t.classList.remove('active'));
    
    // Adicionar active no clicado
    tab.classList.add('active');
    
    // Mudar canal
    currentChannel = tab.dataset.channel;
    
    // Limpar e carregar histórico do canal
    chatMessages.innerHTML = '';
    loadChannelHistory(currentChannel);
  });
});

// Enviar mensagem
function sendMessage() {
  const message = chatInput.value.trim();
  if (!message || !localPlayer) return;
  
  // Comandos especiais
  if (message.startsWith('/')) {
    handleCommand(message);
    chatInput.value = '';
    return;
  }
  
  // Validação
  if (message.length > 200) {
    showNotification('Mensagem muito longa (máx 200 caracteres)', 'error');
    return;
  }
  
  // Enviar ao servidor
  socket.emit('chat', {
    channel: currentChannel,
    message: message
  });
  
  chatInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// Receber mensagens
socket.on('chatMessage', (data) => {
  // Filtrar por canal atual
  if (data.channel !== currentChannel) {
    // Notificar em outras abas (opcional)
    highlightTab(data.channel);
    return;
  }
  
  addMessageToChat(data);
});

// Receber histórico ao logar
socket.on('chatHistory', (history) => {
  chatMessages.innerHTML = '';
  history.forEach(msg => {
    addMessageToChat({
      username: msg.username,
      message: msg.message,
      channel: msg.channel,
      rank: 'Cidadão', // Padrão se não tiver
      rankColor: '#808080',
      timestamp: msg.timestamp
    });
  });
  scrollToBottom();
});

// Adicionar mensagem ao chat
function addMessageToChat(data) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message';
  
  // Timestamp
  const time = new Date(data.timestamp || Date.now());
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
  
  // Construir HTML
  msgDiv.innerHTML = `
    <span style="color: #666; font-size: 11px;">[${timeStr}]</span>
    <span class="chat-username" style="color: ${data.rankColor || '#808080'}">${data.username}</span>
    <span>${escapeHtml(data.message)}</span>
  `;
  
  chatMessages.appendChild(msgDiv);
  scrollToBottom();
  
  // Limitar a 100 mensagens
  if (chatMessages.children.length > 100) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
}

// Comandos de chat
function handleCommand(command) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  
  switch(cmd) {
    case '/me':
      // Ação em terceira pessoa
      const action = parts.slice(1).join(' ');
      if (action) {
        socket.emit('chat', {
          channel: currentChannel,
          message: `*${action}*`
        });
      }
      break;
      
    case '/w':
    case '/whisper':
      // Mensagem privada (futura implementação)
      showNotification('Mensagens privadas em breve!', 'warning');
      break;
      
    case '/help':
      addSystemMessage('Comandos disponíveis:');
      addSystemMessage('/me [ação] - Ação em terceira pessoa');
      addSystemMessage('/w [player] [msg] - Mensagem privada');
      addSystemMessage('/vote [id] - Votar em proposta');
      addSystemMessage('/donate [valor] - Doar ao tesouro');
      addSystemMessage('/help - Mostrar comandos');
      break;
      
    case '/vote':
      const voteId = parseInt(parts[1]);
      if (voteId) {
        socket.emit('vote', { voteId, option: parts[2] });
      } else {
        addSystemMessage('Uso: /vote [id] [opção]');
      }
      break;
      
    case '/donate':
      const amount = parseInt(parts[1]);
      if (amount && amount > 0) {
        if (localPlayer.gems >= amount) {
          socket.emit('donate', { amount });
          addSystemMessage(`Você doou ${amount} Gems ao tesouro!`);
        } else {
          addSystemMessage('Gems insuficientes!');
        }
      } else {
        addSystemMessage('Uso: /donate [valor]');
      }
      break;
      
    default:
      addSystemMessage(`Comando desconhecido: ${cmd}`);
      addSystemMessage('Digite /help para ver comandos disponíveis');
  }
}

// Mensagem do sistema
function addSystemMessage(text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message';
  msgDiv.innerHTML = `<span style="color: #F39C12; font-weight: bold;">[SISTEMA]</span> <span style="color: #aaa;">${text}</span>`;
  chatMessages.appendChild(msgDiv);
  scrollToBottom();
}

// Destacar tab com nova mensagem
function highlightTab(channel) {
  const tab = document.querySelector(`.chat-tab[data-channel="${channel}"]`);
  if (tab && !tab.classList.contains('active')) {
    tab.style.background = 'rgba(241, 196, 15, 0.3)';
    setTimeout(() => {
      tab.style.background = '';
    }, 2000);
  }
}

// Carregar histórico de canal específico
function loadChannelHistory(channel) {
  // Em uma implementação real, faria requisição ao servidor
  // Por ora, apenas limpa a tela
  addSystemMessage(`Canal #${channel} - Histórico de mensagens`);
}

// Scroll automático
function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Escapar HTML (segurança)
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Emojis e formatação (opcional)
function parseMessage(text) {
  // Substituir emojis de texto
  const emojiMap = {
    ':)': '😊',
    ':(': '😢',
    ':D': '😄',
    ':P': '😛',
    '<3': '❤️',
    ':skull:': '💀',
    ':fire:': '🔥',
    ':gem:': '💎'
  };
  
  Object.keys(emojiMap).forEach(key => {
    text = text.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), emojiMap[key]);
  });
  
  return text;
}

// Notificação de menções (futura implementação)
function checkMention(message) {
  if (localPlayer && message.includes(`@${localPlayer.username}`)) {
    // Som de notificação
    playNotificationSound();
    
    // Notificação visual
    showNotification('Você foi mencionado no chat!', 'warning');
  }
}

function playNotificationSound() {
  // Implementar som se desejar
  // const audio = new Audio('/sounds/notification.mp3');
  // audio.play();
}

// Filtro de profanidade (básico)
function filterBadWords(text) {
  const badWords = ['palavra1', 'palavra2']; // Adicionar palavras se necessário
  let filtered = text;
  
  badWords.forEach(word => {
    const regex = new RegExp(word, 'gi');
    filtered = filtered.replace(regex, '*'.repeat(word.length));
  });
  
  return filtered;
}

// Sistema de reações (futura implementação)
function addReaction(messageId, emoji) {
  socket.emit('addReaction', { messageId, emoji });
}

// Mensagens de status
socket.on('playerJoined', (data) => {
  if (currentChannel === 'geral') {
    addSystemMessage(`${data.username} entrou no servidor`);
  }
});

socket.on('playerLeft', (data) => {
  if (currentChannel === 'geral') {
    addSystemMessage(`${data.username} saiu do servidor`);
  }
});

// Mensagens de sistema do servidor
socket.on('systemMessage', (data) => {
  addSystemMessage(data.message);
});

// Avisos de votação
socket.on('voteCreated', (data) => {
  addSystemMessage(`📋 Nova votação: ${data.description}`);
  addSystemMessage(`Digite /vote ${data.id} [opção] para votar`);
});

socket.on('voteEnded', (data) => {
  addSystemMessage(`📊 Votação encerrada: ${data.description}`);
  addSystemMessage(`Resultado: ${data.winner}`);
});

// Anti-spam
let lastMessageTime = 0;
const MESSAGE_COOLDOWN = 1000; // 1 segundo

function canSendMessage() {
  const now = Date.now();
  if (now - lastMessageTime < MESSAGE_COOLDOWN) {
    showNotification('Aguarde um momento antes de enviar outra mensagem', 'warning');
    return false;
  }
  lastMessageTime = now;
  return true;
}

// Modificar função de envio para incluir anti-spam
const originalSendMessage = sendMessage;
sendMessage = function() {
  if (!canSendMessage()) return;
  originalSendMessage();
};

// Auto-complete de menções (futura implementação)
chatInput.addEventListener('input', (e) => {
  const text = e.target.value;
  if (text.includes('@')) {
    // Mostrar lista de players online
    // showPlayerSuggestions();
  }
});

// Inicializar
console.log('✅ Sistema de chat carregado');