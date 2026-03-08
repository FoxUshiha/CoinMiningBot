// index.js - Bot de Mineração com Picaretas (Otimizado)
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const crypto = require('crypto');

// ==================== CONFIGURAÇÕES ====================
const API_BASE_URL = process.env.API_BASE_URL || 'https://bank.foxsrv.net';
const TOKEN = process.env.DISCORD_TOKEN || "YOUR_TOKEN";
const CLIENT_ID = process.env.CLIENT_ID || "1480004665218437263";

if (!TOKEN || !CLIENT_ID) {
    console.error('❌ DISCORD_TOKEN e CLIENT_ID são obrigatórios!');
    process.exit(1);
}

const DB_PATH = path.join(__dirname, 'mine.db');
const IMAGES_PATH = path.join(__dirname, 'images');
const MINE_IMAGE = path.join(IMAGES_PATH, 'mine.png');
const BREAD_IMAGE = path.join(IMAGES_PATH, 'pao.png');

// Garante que a pasta de imagens existe
fs.ensureDirSync(IMAGES_PATH);

// Cache para minerações ativas
const activeMines = new Map(); // key: `${guildId}-${userId}`

// ==================== CONFIGURAÇÕES DAS PICARETAS ====================
const PICKAXES = {
    'mao': {
        name: '👊 Mão',
        price: '0.00000000',
        durability: Infinity,
        mineTime: 123000, // 1.5 minutos
        minReward: 0,
        maxReward: 0.00000002,
        image: 'mao.png',
        emoji: '👊'
    },
    'madeira': {
        name: '📋 Madeira',
        price: '0.00000010',
        durability: 10,
        mineTime: 120000, // 1 minuto
        minReward: 0,
        maxReward: 0.00000009,
        image: 'madeira.png',
        emoji: '📋'
    },
    'pedra': {
        name: '🧨 Pedra',
        price: '0.00000050',
        durability: 30,
        mineTime: 100000, // 1 minuto
        minReward: 0.00000005,
        maxReward: 0.00000009,
        image: 'pedra.png',
        emoji: '🧨'
    },
    'ouro': {
        name: '🏆 Ouro',
        price: '0.00000075',
        durability: 50,
        mineTime: 100000, // 55 segundos
        minReward: 0.00000007,
        maxReward: 0.00000020,
        image: 'ouro.png',
        emoji: '🏆'
    },
    'ametista': {
        name: '💜 Ametista',
        price: '0.00000100',
        durability: 100,
        mineTime: 90000, // 50 segundos
        minReward: 0.00000008,
        maxReward: 0.00000045,
        image: 'ametista.png',
        emoji: '💜'
    },
    'cobre': {
        name: '🔴 Cobre',
        price: '0.00000250',
        durability: 150,
        mineTime: 90000, // 45 segundos
        minReward: 0.00000005,
        maxReward: 0.00000100,
        image: 'cobre.png',
        emoji: '🔴'
    },
    'ferro': {
        name: '🔩 Ferro',
        price: '0.00001000',
        durability: 200,
        mineTime: 80000, // 30 segundos
        minReward: 0.00000015,
        maxReward: 0.00000250,
        image: 'ferro.png',
        emoji: '🔩'
    },
    'diamante': {
        name: '💎 Diamante',
        price: '0.00005000',
        durability: 250,
        mineTime: 70000, // 20 segundos
        minReward: 0.00000025,
        maxReward: 0.00000500,
        image: 'diamante.png',
        emoji: '💎'
    },
    'titanio': {
        name: '⚡ Titânio',
        price: '0.00010000',
        durability: 300,
        mineTime: 60000, // 10 segundos
        minReward: 0.00000050,
        maxReward: 0.00001000,
        image: 'titanio.png',
        emoji: '⚡'
    }
};

// ==================== UTILS ====================
function formatCoins(amount) {
    if (amount === 0) return '0.00000000';
    return Number(amount).toFixed(8);
}

function formatTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomReward(min, max) {
    return min + (Math.random() * (max - min));
}

function calculateDurabilityLoss(reward, min, max) {
    const percentage = (reward - min) / (max - min);
    // Se for mínimo: 1, se for máximo: 5, linear no meio
    return Math.max(1, Math.min(5, Math.floor(1 + (percentage * 4))));
}

function createProgressBar(percentage) {
    const filled = Math.floor(percentage / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

// ==================== PAYMENT QUEUE ====================
class PaymentQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.stats = { processed: 0, failed: 0 };
    }

    add(payment) {
        const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        this.queue.push({
            ...payment,
            id,
            attempts: 0,
            createdAt: Date.now(),
            maxAttempts: 10
        });
        console.log(`📥 [${id}] Pagamento adicionado: ${payment.amount} coins para ${payment.userId}`);
        this.process();
        return id;
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;

        while (this.queue.length > 0) {
            const payment = this.queue[0];

            try {
                payment.attempts++;
                
                console.log(`💸 [${payment.id}] Processando pagamento (${payment.attempts}/${payment.maxAttempts})`);

                const transfer = await this.transferBetweenCards(
                    payment.fromCard,
                    payment.toCard,
                    payment.amount,
                    payment.id
                );

                if (transfer.success) {
                    this.queue.shift();
                    this.stats.processed++;
                    
                    console.log(`✅ [${payment.id}] Pagamento realizado! TxID: ${transfer.txId}`);

                    if (payment.onSuccess) {
                        await payment.onSuccess(transfer.txId);
                    }
                } else {
                    throw new Error(transfer.error || 'Falha na transferência');
                }

            } catch (error) {
                console.log(`❌ [${payment.id}] Falha: ${error.message}`);

                if (payment.attempts >= payment.maxAttempts) {
                    this.queue.shift();
                    this.stats.failed++;
                    
                    if (payment.onFailure) {
                        await payment.onFailure(error.message);
                    }
                } else {
                    this.queue.shift();
                    this.queue.push(payment);
                }
            }

            await sleep(1010); // Delay entre processamentos
        }

        this.processing = false;
    }

    async transferBetweenCards(fromCard, toCard, amount, reference) {
        try {
            const response = await axios.post(`${API_BASE_URL}/api/card/pay`, {
                fromCard,
                toCard,
                amount: formatCoins(amount)
            }, {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data) {
                if (response.data.success === true || response.data.txId) {
                    return { 
                        success: true, 
                        txId: response.data.txId || response.data.tx_id || response.data.txid || reference
                    };
                }
                return { success: false, error: response.data.error || 'Falha na transferência' };
            }
            return { success: false, error: 'Resposta vazia da API' };
            
        } catch (error) {
            if (error.response) {
                return { success: false, error: error.response.data?.error || `HTTP ${error.response.status}` };
            }
            if (error.code === 'ECONNABORTED') {
                return { success: false, error: 'Timeout' };
            }
            return { success: false, error: error.message };
        }
    }

    getQueueLength() {
        return this.queue.length;
    }
}

const paymentQueue = new PaymentQueue();

// ==================== API SERVICE ====================
class ApiService {
    async getCardInfo(cardCode) {
        try {
            const response = await axios.post(`${API_BASE_URL}/api/card/info`, {
                cardCode
            }, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.data && response.data.success) {
                return response.data;
            }
            return null;
        } catch (error) {
            console.error('Erro ao buscar card info:', error.message);
            return null;
        }
    }
}

const api = new ApiService();

// ==================== DATABASE ====================
let db;

async function initDatabase() {
    db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS guilds (
            guild_id TEXT PRIMARY KEY,
            server_card_id TEXT,
            total_coins_mined TEXT DEFAULT '0.00000000',
            total_pickaxes_sold INTEGER DEFAULT 0,
            total_coins_received TEXT DEFAULT '0.00000000',
            total_mines INTEGER DEFAULT 0,
            total_users INTEGER DEFAULT 0,
            created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT,
            guild_id TEXT,
            card_id TEXT,
            current_pickaxe TEXT DEFAULT 'mao',
            pickaxe_durability INTEGER DEFAULT 0,
            total_mines INTEGER DEFAULT 0,
            total_coins_mined TEXT DEFAULT '0.00000000',
            total_coins_spent TEXT DEFAULT '0.00000000',
            energy INTEGER DEFAULT 100,
            bread INTEGER DEFAULT 0,
            last_mine_at INTEGER,
            created_at INTEGER,
            PRIMARY KEY (user_id, guild_id)
        );

        CREATE TABLE IF NOT EXISTS mining_history (
            id TEXT PRIMARY KEY,
            guild_id TEXT,
            user_id TEXT,
            pickaxe TEXT,
            reward TEXT,
            durability_lost INTEGER,
            tx_id TEXT,
            created_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS shop_history (
            id TEXT PRIMARY KEY,
            guild_id TEXT,
            user_id TEXT,
            item_type TEXT,
            item_name TEXT,
            price TEXT,
            tx_id TEXT,
            created_at INTEGER
        );
    `);

    console.log('📦 Banco de dados inicializado');
}

// ==================== CLIENT DISCORD ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// ==================== COMANDOS ====================
const commands = [
    // Comando principal em português
    new SlashCommandBuilder()
        .setName('minerar')
        .setDescription('Sistema de mineração')
        .addSubcommand(subcommand =>
            subcommand
                .setName('minerar')
                .setDescription('Começa a minerar'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('shop')
                .setDescription('Abrir a loja de picaretas')
                .addStringOption(option =>
                    option.setName('picareta')
                        .setDescription('Escolha uma picareta')
                        .setRequired(true)
                        .addChoices(
                            { name: '👊 Mão (0 coins)', value: 'mao' },
                            { name: '🪵 Madeira (0.00000010)', value: 'madeira' },
                            { name: '🪨 Pedra (0.00000020)', value: 'pedra' },
                            { name: '🪙 Ouro (0.00000050)', value: 'ouro' },
                            { name: '💜 Ametista (0.00000100)', value: 'ametista' },
                            { name: '🔴 Cobre (0.00000200)', value: 'cobre' },
                            { name: '⚙️ Ferro (0.00001000)', value: 'ferro' },
                            { name: '💎 Diamante (0.00005000)', value: 'diamante' },
                            { name: '⚡ Titânio (0.00010000)', value: 'titanio' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('shop-pao')
                .setDescription('Comprar pães (5 unidades - 0.00000010)')
                .addIntegerOption(option =>
                    option.setName('quantidade')
                        .setDescription('Quantidade de pacotes (cada pacote = 5 pães)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(100)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('comer')
                .setDescription('Comer um pão para recuperar energia'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('Ver suas estatísticas de mineração'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('guild')
                .setDescription('Ver estatísticas da guild'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('card')
                .setDescription('Registrar seu card para receber pagamentos')
                .addStringOption(option =>
                    option.setName('card_id')
                        .setDescription('Seu Card ID')
                        .setRequired(true))),

    // Comando alternativo em inglês
    new SlashCommandBuilder()
        .setName('mine')
        .setDescription('Mining system')
        .addSubcommand(subcommand =>
            subcommand
                .setName('mine')
                .setDescription('Start mining'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('shop')
                .setDescription('Open pickaxe shop')
                .addStringOption(option =>
                    option.setName('pickaxe')
                        .setDescription('Choose a pickaxe')
                        .setRequired(true)
                        .addChoices(
                            { name: '👊 Hand (0 coins)', value: 'mao' },
                            { name: '🪵 Wood (0.00000010)', value: 'madeira' },
                            { name: '🪨 Stone (0.00000020)', value: 'pedra' },
                            { name: '🪙 Gold (0.00000050)', value: 'ouro' },
                            { name: '💜 Amethyst (0.00000100)', value: 'ametista' },
                            { name: '🔴 Copper (0.00000200)', value: 'cobre' },
                            { name: '⚙️ Iron (0.00001000)', value: 'ferro' },
                            { name: '💎 Diamond (0.00005000)', value: 'diamante' },
                            { name: '⚡ Titanium (0.00010000)', value: 'titanio' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('shop-bread')
                .setDescription('Buy bread (5 units - 0.00000010)')
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Amount of packs (each pack = 5 breads)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(100)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('eat')
                .setDescription('Eat bread to recover energy'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View your mining stats'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('guild')
                .setDescription('View guild stats'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('card')
                .setDescription('Register your card to receive payments')
                .addStringOption(option =>
                    option.setName('card_id')
                        .setDescription('Your Card ID')
                        .setRequired(true))),

    // Comandos de admin
    new SlashCommandBuilder()
        .setName('minerar-servercard')
        .setDescription('[ADMIN] Configurar o card do servidor')
        .addStringOption(option =>
            option.setName('card_id')
                .setDescription('Card ID do servidor')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('mine-servercard')
        .setDescription('[ADMIN] Set server card ID')
        .addStringOption(option =>
            option.setName('card_id')
                .setDescription('Server Card ID')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

// ==================== REGISTRO DE COMANDOS ====================
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(TOKEN);
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Comandos registrados');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
}

// ==================== HANDLERS DE COMANDOS ====================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, guildId, user, member } = interaction;

    try {
        await initDatabase();

        // ===== COMANDOS DE ADMIN =====
        if (commandName === 'minerar-servercard' || commandName === 'mine-servercard') {
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ 
                    content: '❌ Apenas administradores podem usar este comando.', 
                    ephemeral: true 
                });
            }

            const cardId = interaction.options.getString('card_id');
            
            await interaction.deferReply({ ephemeral: true });

            const cardInfo = await api.getCardInfo(cardId);
            if (!cardInfo) {
                return interaction.editReply('❌ Card ID inválido. Verifique e tente novamente.');
            }

            await db.run(`
                INSERT INTO guilds (guild_id, server_card_id, created_at)
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET server_card_id = ?
            `, [guildId, cardId, Date.now(), cardId]);

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Card do Servidor Configurado')
                .setDescription(`Card ID: \`${cardId}\`\nSaldo: **${cardInfo.coins}** coins`)
                .setThumbnail('attachment://mine.png')
                .setTimestamp();

            const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
            
            await interaction.editReply({ 
                embeds: [embed],
                files: file ? [file] : []
            });
        }

        // ===== REGISTRAR CARD DO USUÁRIO =====
        else if ((commandName === 'minerar' && interaction.options.getSubcommand() === 'card') ||
                 (commandName === 'mine' && interaction.options.getSubcommand() === 'card')) {
            
            const cardId = interaction.options.getString('card_id');
            
            await interaction.deferReply({ ephemeral: true });

            const cardInfo = await api.getCardInfo(cardId);
            if (!cardInfo) {
                return interaction.editReply('❌ Card ID inválido. Verifique e tente novamente.');
            }

            const existingUser = await db.get(
                'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
                [user.id, guildId]
            );

            if (!existingUser) {
                await db.run(`
                    INSERT INTO users (user_id, guild_id, card_id, current_pickaxe, pickaxe_durability, energy, bread, created_at)
                    VALUES (?, ?, ?, 'mao', 0, 100, 0, ?)
                `, [user.id, guildId, cardId, Date.now()]);
            } else {
                await db.run(`
                    UPDATE users SET card_id = ? WHERE user_id = ? AND guild_id = ?
                `, [cardId, user.id, guildId]);
            }

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('✅ Card Registrado com Sucesso!')
                .setDescription(`Card ID: \`${cardId}\`\nSaldo: **${cardInfo.coins}** coins`)
                .setThumbnail('attachment://mine.png')
                .setFooter({ text: 'Agora você pode minerar!' })
                .setTimestamp();

            const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
            
            await interaction.editReply({ 
                embeds: [embed],
                files: file ? [file] : []
            });
        }

        // ===== SHOP (COMPRAR PICARETA) =====
        else if ((commandName === 'minerar' && interaction.options.getSubcommand() === 'shop') ||
                 (commandName === 'mine' && interaction.options.getSubcommand() === 'shop')) {
            
            const pickaxeKey = interaction.options.getString(commandName === 'minerar' ? 'picareta' : 'pickaxe');
            
            await interaction.deferReply();

            // Verifica se usuário tem card
            const userData = await db.get(
                'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
                [user.id, guildId]
            );

            if (!userData || !userData.card_id) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Card não registrado')
                    .setDescription('Você precisa registrar seu card primeiro!\nUse `/minerar card SEU_CARD_ID`')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            // Verifica se guild tem card
            const guildData = await db.get(
                'SELECT server_card_id FROM guilds WHERE guild_id = ?',
                guildId
            );

            if (!guildData || !guildData.server_card_id) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Servidor não configurado')
                    .setDescription('O servidor ainda não configurou um card. Contate um administrador.')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            const pickaxe = PICKAXES[pickaxeKey];
            if (!pickaxe) {
                return interaction.editReply('❌ Picareta inválida.');
            }

            // Se for a mão, é de graça
            if (pickaxeKey === 'mao') {
                await db.run(`
                    UPDATE users 
                    SET current_pickaxe = 'mao',
                        pickaxe_durability = 0
                    WHERE user_id = ? AND guild_id = ?
                `, [user.id, guildId]);

                const embed = new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setTitle('✅ Picareta Equipada!')
                    .setDescription(`Você agora está usando: ${pickaxe.name}`)
                    .addFields(
                        { name: '⛏️ Picareta', value: pickaxe.name, inline: true },
                        { name: '⏱️ Tempo', value: formatTime(pickaxe.mineTime), inline: true },
                        { name: '💰 Recompensa', value: `${formatCoins(pickaxe.minReward)} - ${formatCoins(pickaxe.maxReward)}`, inline: true }
                    )
                    .setThumbnail(`attachment://${pickaxe.image}`)
                    .setTimestamp();

                const imagePath = path.join(IMAGES_PATH, pickaxe.image);
                const file = await fs.pathExists(imagePath) ? imagePath : null;
                
                return interaction.editReply({ 
                    embeds: [embed],
                    files: file ? [file] : []
                });
            }

            // Verifica saldo do usuário
            const userCardInfo = await api.getCardInfo(userData.card_id);
            if (!userCardInfo) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Card Inválido')
                    .setDescription('Seu card parece inválido. Registre novamente com `/minerar card`')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            const price = parseFloat(pickaxe.price);
            const userBalance = parseFloat(userCardInfo.coins);

            if (userBalance < price) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Saldo Insuficiente')
                    .setDescription(`Você precisa de **${pickaxe.price}** coins\nSeu saldo: **${userCardInfo.coins}** coins`)
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            // Adiciona à fila de pagamento (usuário paga o servidor)
            paymentQueue.add({
                fromCard: userData.card_id,
                toCard: guildData.server_card_id,
                amount: price,
                userId: user.id,
                onSuccess: async (txId) => {
                    // Atualiza usuário
                    await db.run(`
                        UPDATE users 
                        SET current_pickaxe = ?,
                            pickaxe_durability = ?,
                            total_coins_spent = CAST(total_coins_spent AS DECIMAL) + CAST(? AS DECIMAL)
                        WHERE user_id = ? AND guild_id = ?
                    `, [pickaxeKey, pickaxe.durability, price, user.id, guildId]);

                    // Atualiza estatísticas da guild
                    await db.run(`
                        UPDATE guilds 
                        SET total_pickaxes_sold = total_pickaxes_sold + 1,
                            total_coins_received = CAST(total_coins_received AS DECIMAL) + CAST(? AS DECIMAL)
                        WHERE guild_id = ?
                    `, [price, guildId]);

                    // Salva histórico
                    const historyId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
                    await db.run(`
                        INSERT INTO shop_history (id, guild_id, user_id, item_type, item_name, price, tx_id, created_at)
                        VALUES (?, ?, ?, 'pickaxe', ?, ?, ?, ?)
                    `, [historyId, guildId, user.id, pickaxe.name, price, txId, Date.now()]);

                    // Envia embed de sucesso
                    try {
                        const channel = interaction.channel;
                        const embed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle('✅ Compra Realizada com Sucesso!')
                            .setDescription(`${user} comprou **${pickaxe.name}**!`)
                            .addFields(
                                { name: '💰 Preço', value: `${pickaxe.price} coins`, inline: true },
                                { name: '🔨 Durabilidade', value: pickaxe.durability.toString(), inline: true },
                                { name: '⛏️ Picareta', value: pickaxe.name, inline: true },
                                { name: '⏱️ Tempo', value: formatTime(pickaxe.mineTime), inline: true },
                                { name: '💎 Recompensa', value: `${formatCoins(pickaxe.minReward)} - ${formatCoins(pickaxe.maxReward)}`, inline: true },
                                { name: '🆔 TxID', value: txId ? `\`${txId.substring(0, 8)}...\`` : 'N/A', inline: true }
                            )
                            .setThumbnail(`attachment://${pickaxe.image}`)
                            .setTimestamp();

                        const imagePath = path.join(IMAGES_PATH, pickaxe.image);
                        const file = await fs.pathExists(imagePath) ? imagePath : null;
                        
                        await channel.send({ 
                            embeds: [embed],
                            files: file ? [file] : []
                        });
                    } catch (err) {
                        console.error('Erro ao enviar mensagem de sucesso:', err);
                    }
                },
                onFailure: async (error) => {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('❌ Falha na Compra')
                        .setDescription(`Erro: ${error}\n\nTente novamente mais tarde.`)
                        .setThumbnail('attachment://mine.png')
                        .setTimestamp();

                    const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                    
                    await interaction.followUp({ 
                        embeds: [embed],
                        files: file ? [file] : [],
                        ephemeral: true
                    });
                }
            });

            const embed = new EmbedBuilder()
                .setColor(0xFFFF00)
                .setTitle('⏳ Processando Compra...')
                .setDescription(`Sua compra da **${pickaxe.name}** foi adicionada à fila de pagamentos.\nPosição na fila: **${paymentQueue.getQueueLength()}**`)
                .setThumbnail('attachment://mine.png')
                .setTimestamp();

            const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
            
            await interaction.editReply({ 
                embeds: [embed],
                files: file ? [file] : []
            });
        }

        // ===== SHOP PÃO =====
        else if ((commandName === 'minerar' && interaction.options.getSubcommand() === 'shop-pao') ||
                 (commandName === 'mine' && interaction.options.getSubcommand() === 'shop-bread')) {
            
            const quantity = interaction.options.getInteger(commandName === 'minerar' ? 'quantidade' : 'amount');
            
            await interaction.deferReply();

            const userData = await db.get(
                'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
                [user.id, guildId]
            );

            if (!userData || !userData.card_id) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Card não registrado')
                    .setDescription('Registre seu card com `/minerar card`')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            const guildData = await db.get(
                'SELECT server_card_id FROM guilds WHERE guild_id = ?',
                guildId
            );

            if (!guildData || !guildData.server_card_id) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Servidor não configurado')
                    .setDescription('Contate um administrador.')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            const breadPrice = 0.00000010 * quantity;
            const breadAmount = quantity * 5;

            const userCardInfo = await api.getCardInfo(userData.card_id);
            if (!userCardInfo || parseFloat(userCardInfo.coins) < breadPrice) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Saldo Insuficiente')
                    .setDescription(`Preço: **${formatCoins(breadPrice)}** coins\nSeu saldo: **${userCardInfo?.coins || '0'}** coins`)
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            // Adiciona à fila
            paymentQueue.add({
                fromCard: userData.card_id,
                toCard: guildData.server_card_id,
                amount: breadPrice,
                userId: user.id,
                onSuccess: async (txId) => {
                    await db.run(`
                        UPDATE users 
                        SET bread = bread + ?,
                            total_coins_spent = CAST(total_coins_spent AS DECIMAL) + CAST(? AS DECIMAL)
                        WHERE user_id = ? AND guild_id = ?
                    `, [breadAmount, breadPrice, user.id, guildId]);

                    const historyId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
                    await db.run(`
                        INSERT INTO shop_history (id, guild_id, user_id, item_type, item_name, price, tx_id, created_at)
                        VALUES (?, ?, ?, 'bread', 'Pão', ?, ?, ?)
                    `, [historyId, guildId, user.id, breadPrice, txId, Date.now()]);

                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('✅ Pães Comprados!')
                        .setDescription(`${user} comprou **${breadAmount} pães**!`)
                        .addFields(
                            { name: '💰 Preço', value: `${formatCoins(breadPrice)} coins`, inline: true },
                            { name: '🍞 Quantidade', value: breadAmount.toString(), inline: true },
                            { name: '🆔 TxID', value: txId ? `\`${txId.substring(0, 8)}...\`` : 'N/A', inline: true }
                        )
                        .setThumbnail('attachment://pao.png')
                        .setTimestamp();

                    const file = await fs.pathExists(BREAD_IMAGE) ? BREAD_IMAGE : null;
                    
                    await interaction.channel.send({ 
                        embeds: [embed],
                        files: file ? [file] : []
                    });
                },
                onFailure: async (error) => {
                    const embed = new EmbedBuilder()
                        .setColor(0xFF0000)
                        .setTitle('❌ Falha na Compra')
                        .setDescription(`Erro: ${error}`)
                        .setThumbnail('attachment://mine.png')
                        .setTimestamp();

                    const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                    
                    await interaction.followUp({ 
                        embeds: [embed],
                        files: file ? [file] : [],
                        ephemeral: true
                    });
                }
            });

            const embed = new EmbedBuilder()
                .setColor(0xFFFF00)
                .setTitle('⏳ Processando Compra...')
                .setDescription(`Compra de **${breadAmount} pães** adicionada à fila.\nPosição: **${paymentQueue.getQueueLength()}**`)
                .setThumbnail('attachment://mine.png')
                .setTimestamp();

            const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
            
            await interaction.editReply({ 
                embeds: [embed],
                files: file ? [file] : []
            });
        }

        // ===== COMER =====
        else if ((commandName === 'minerar' && interaction.options.getSubcommand() === 'comer') ||
                 (commandName === 'mine' && interaction.options.getSubcommand() === 'eat')) {
            
            await interaction.deferReply();

            const userData = await db.get(
                'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
                [user.id, guildId]
            );

            if (!userData) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Registre-se primeiro')
                    .setDescription('Use `/minerar card` para começar.')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            if (userData.bread <= 0) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Sem Pães')
                    .setDescription('Compre pães na loja com `/minerar shop-pao`')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            if (userData.energy >= 100) {
                const embed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('⚡ Energia Cheia')
                    .setDescription('Sua energia já está no máximo!')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            const newEnergy = Math.min(100, userData.energy + 10);
            
            await db.run(`
                UPDATE users 
                SET energy = ?,
                    bread = bread - 1
                WHERE user_id = ? AND guild_id = ?
            `, [newEnergy, user.id, guildId]);

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🍞 Você Comeu um Pão!')
                .setDescription(`${user} recuperou energia!`)
                .addFields(
                    { name: '⚡ Energia Anterior', value: `${userData.energy}/100`, inline: true },
                    { name: '⚡ Energia Atual', value: `${newEnergy}/100`, inline: true },
                    { name: '🍞 Pães Restantes', value: (userData.bread - 1).toString(), inline: true }
                )
                .setThumbnail('attachment://pao.png')
                .setTimestamp();

            const file = await fs.pathExists(BREAD_IMAGE) ? BREAD_IMAGE : null;
            
            await interaction.editReply({ 
                embeds: [embed],
                files: file ? [file] : []
            });
        }

        // ===== MINERAR (OTIMIZADO) =====
        else if ((commandName === 'minerar' && interaction.options.getSubcommand() === 'minerar') ||
                 (commandName === 'mine' && interaction.options.getSubcommand() === 'mine')) {
            
            const cacheKey = `${guildId}-${user.id}`;
            
            // Verifica se já está minerando
            if (activeMines.has(cacheKey)) {
                const mineData = activeMines.get(cacheKey);
                const timeLeft = mineData.endTime - Date.now();
                
                return interaction.reply({ 
                    content: `⛏️ Você já está minerando! Termina em ${formatTime(timeLeft)}.`,
                    ephemeral: true 
                });
            }

            await interaction.deferReply();

            const userData = await db.get(
                'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
                [user.id, guildId]
            );

            if (!userData || !userData.card_id) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Card não registrado')
                    .setDescription('Registre seu card com `/minerar card`')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            const guildData = await db.get(
                'SELECT server_card_id FROM guilds WHERE guild_id = ?',
                guildId
            );

            if (!guildData || !guildData.server_card_id) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Servidor não configurado')
                    .setDescription('Contate um administrador.')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            // Verifica energia
            if (userData.energy <= 0) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Sem Energia')
                    .setDescription('Coma um pão para recuperar energia!\nUse `/minerar comer`')
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            const pickaxe = PICKAXES[userData.current_pickaxe];
            
            // Verifica durabilidade
            if (userData.current_pickaxe !== 'mao' && userData.pickaxe_durability <= 0) {
                // Picareta quebrada
                await db.run(`
                    UPDATE users 
                    SET current_pickaxe = 'mao',
                        pickaxe_durability = 0
                    WHERE user_id = ? AND guild_id = ?
                `, [user.id, guildId]);

                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('💥 Picareta Quebrada!')
                    .setDescription(`Sua ${pickaxe.name} quebrou! Você voltou a minerar com a 👊 Mão.`)
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ embeds: [embed], files: file ? [file] : [] });
            }

            // Processo de mineração
            const startTime = Date.now();
            const mineTime = pickaxe.mineTime;
            const endTime = startTime + mineTime;

            // Cache da mineração
            activeMines.set(cacheKey, {
                startTime,
                endTime,
                mineTime,
                pickaxe: userData.current_pickaxe,
                messageId: null,
                channelId: interaction.channel.id
            });

            // Mensagem inicial
            const progressEmbed = new EmbedBuilder()
                .setColor(0xFFFF00)
                .setTitle('⛏️ Minerando...')
                .setDescription(`**Picareta:** ${pickaxe.name}\n**Tempo:** ${formatTime(mineTime)}\n**Progresso:**\n\`[${createProgressBar(0)}] 0%\``)
                .addFields(
                    { name: '⚡ Energia', value: `${userData.energy}/100`, inline: true },
                    { name: '🔨 Durabilidade', value: userData.current_pickaxe === 'mao' ? '∞' : userData.pickaxe_durability.toString(), inline: true },
                    { name: '⏰ Termina', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true }
                )
                .setThumbnail('attachment://mine.png')
                .setTimestamp();

            const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
            const message = await interaction.editReply({ 
                embeds: [progressEmbed],
                files: file ? [file] : []
            });

            // Atualiza cache com ID da mensagem
            activeMines.set(cacheKey, {
                ...activeMines.get(cacheKey),
                messageId: message.id
            });

            // Função para atualizar progresso
            const updateProgress = async () => {
                const now = Date.now();
                const elapsed = now - startTime;
                const percentage = Math.min(100, Math.floor((elapsed / mineTime) * 100));
                
                if (percentage >= 100) return;

                const embed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('⛏️ Minerando...')
                    .setDescription(`**Picareta:** ${pickaxe.name}\n**Tempo:** ${formatTime(mineTime)}\n**Progresso:**\n\`[${createProgressBar(percentage)}] ${percentage}%\``)
                    .addFields(
                        { name: '⚡ Energia', value: `${userData.energy}/100`, inline: true },
                        { name: '🔨 Durabilidade', value: userData.current_pickaxe === 'mao' ? '∞' : userData.pickaxe_durability.toString(), inline: true },
                        { name: '⏰ Termina', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true }
                    )
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                try {
                    await message.edit({ embeds: [embed] });
                } catch (err) {
                    console.error('Erro ao atualizar progresso:', err);
                }
            };

            // Loop de atualização a cada 2 segundos
            const updateInterval = setInterval(updateProgress, 2000);

            // Aguarda o tempo total
            setTimeout(async () => {
                clearInterval(updateInterval);
                
                // Remove do cache
                activeMines.delete(cacheKey);

                // Calcula recompensa
                const reward = randomReward(pickaxe.minReward, pickaxe.maxReward);
                const durabilityLoss = userData.current_pickaxe === 'mao' ? 0 : calculateDurabilityLoss(reward, pickaxe.minReward, pickaxe.maxReward);
                
                const newDurability = userData.current_pickaxe === 'mao' ? 0 : Math.max(0, userData.pickaxe_durability - durabilityLoss);
                const newEnergy = userData.energy - 1;

                // Adiciona pagamento à fila
                paymentQueue.add({
                    fromCard: guildData.server_card_id,
                    toCard: userData.card_id,
                    amount: reward,
                    userId: user.id,
                    onSuccess: async (txId) => {
                        // Atualiza banco de dados
                        await db.run(`
                            UPDATE users 
                            SET energy = ?,
                                pickaxe_durability = ?,
                                total_mines = total_mines + 1,
                                total_coins_mined = CAST(total_coins_mined AS DECIMAL) + CAST(? AS DECIMAL),
                                last_mine_at = ?
                            WHERE user_id = ? AND guild_id = ?
                        `, [newEnergy, newDurability, reward, Date.now(), user.id, guildId]);

                        await db.run(`
                            UPDATE guilds 
                            SET total_coins_mined = CAST(total_coins_mined AS DECIMAL) + CAST(? AS DECIMAL),
                                total_mines = total_mines + 1
                            WHERE guild_id = ?
                        `, [reward, guildId]);

                        // Atualiza contador de usuários
                        const userCount = await db.get(
                            'SELECT COUNT(DISTINCT user_id) as count FROM users WHERE guild_id = ?',
                            guildId
                        );
                        await db.run(`
                            UPDATE guilds SET total_users = ? WHERE guild_id = ?
                        `, [userCount.count, guildId]);

                        const historyId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
                        await db.run(`
                            INSERT INTO mining_history (id, guild_id, user_id, pickaxe, reward, durability_lost, tx_id, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        `, [historyId, guildId, user.id, userData.current_pickaxe, reward, durabilityLoss, txId, Date.now()]);

                        // Embed de sucesso
                        const resultEmbed = new EmbedBuilder()
                            .setColor(0x00FF00)
                            .setTitle('💰 Mineração Concluída!')
                            .setDescription(`${user} minerou **${formatCoins(reward)}** coins!`)
                            .addFields(
                                { name: '⛏️ Picareta', value: pickaxe.name, inline: true },
                                { name: '💰 Recompensa', value: formatCoins(reward), inline: true },
                                { name: '🔨 Durabilidade', value: userData.current_pickaxe === 'mao' ? '∞' : `${newDurability}/${pickaxe.durability} (-${durabilityLoss})`, inline: true },
                                { name: '⚡ Energia', value: `${newEnergy}/100`, inline: true },
                                { name: '🆔 TxID', value: txId ? `\`${txId.substring(0, 8)}...\`` : 'N/A', inline: true }
                            )
                            .setThumbnail('attachment://mine.png')
                            .setTimestamp();

                        const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                        await message.edit({ 
                            embeds: [resultEmbed],
                            files: file ? [file] : []
                        });
                    },
                    onFailure: async (error) => {
                        const resultEmbed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('❌ Falha na Mineração')
                            .setDescription(`Erro ao processar pagamento: ${error}`)
                            .addFields(
                                { name: '⛏️ Picareta', value: pickaxe.name, inline: true },
                                { name: '💰 Recompensa', value: formatCoins(reward), inline: true },
                                { name: '⚡ Energia', value: `${newEnergy}/100`, inline: true }
                            )
                            .setThumbnail('attachment://mine.png')
                            .setTimestamp();

                        const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                        await message.edit({ 
                            embeds: [resultEmbed],
                            files: file ? [file] : []
                        });
                    }
                });

                // Se a picareta quebrou, atualiza para mão
                if (userData.current_pickaxe !== 'mao' && newDurability <= 0) {
                    await db.run(`
                        UPDATE users 
                        SET current_pickaxe = 'mao',
                            pickaxe_durability = 0
                        WHERE user_id = ? AND guild_id = ?
                    `, [user.id, guildId]);
                }
            }, mineTime);
        }

        // ===== STATS =====
        else if ((commandName === 'minerar' && interaction.options.getSubcommand() === 'stats') ||
                 (commandName === 'mine' && interaction.options.getSubcommand() === 'stats')) {
            
            await interaction.deferReply({ ephemeral: true });

            const userData = await db.get(
                'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
                [user.id, guildId]
            );

            if (!userData) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Sem Dados')
                    .setDescription('Você ainda não começou a minerar!\nUse `/minerar card` para registrar seu card.')
                    .setThumbnail(user.displayAvatarURL())
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }

            const pickaxe = PICKAXES[userData.current_pickaxe];
            const cardInfo = await api.getCardInfo(userData.card_id);
            
            const energyBar = createProgressBar(Math.floor((userData.energy / 100) * 100));

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`📊 Estatísticas de ${user.username}`)
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: '⛏️ Picareta', value: pickaxe.name, inline: true },
                    { name: '🔨 Durabilidade', value: userData.current_pickaxe === 'mao' ? '∞' : `${userData.pickaxe_durability}/${pickaxe.durability}`, inline: true },
                    { name: '⚡ Energia', value: `\`[${energyBar}] ${userData.energy}/100\``, inline: false },
                    { name: '🍞 Pães', value: userData.bread.toString(), inline: true },
                    { name: '💰 Saldo', value: cardInfo?.coins || '0.00000000', inline: true },
                    { name: '⛏️ Total Minerações', value: userData.total_mines.toString(), inline: true },
                    { name: '💎 Total Minerado', value: userData.total_coins_mined || '0.00000000', inline: true },
                    { name: '💸 Total Gasto', value: userData.total_coins_spent || '0.00000000', inline: true },
                    { name: '⏰ Última Mineração', value: userData.last_mine_at ? `<t:${Math.floor(userData.last_mine_at / 1000)}:R>` : 'Nunca', inline: true }
                )
                .setFooter({ text: 'Use /minerar shop para comprar picaretas' })
                .setTimestamp();

            const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
            
            await interaction.editReply({ 
                embeds: [embed],
                files: file ? [file] : []
            });
        }

        // ===== GUILD STATS =====
        else if ((commandName === 'minerar' && interaction.options.getSubcommand() === 'guild') ||
                 (commandName === 'mine' && interaction.options.getSubcommand() === 'guild')) {
            
            await interaction.deferReply();

            const guildData = await db.get(
                'SELECT * FROM guilds WHERE guild_id = ?',
                guildId
            );

            if (!guildData) {
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Sem Dados')
                    .setDescription('Este servidor ainda não tem estatísticas de mineração.')
                    .setThumbnail(interaction.guild.iconURL() || null)
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                return interaction.editReply({ 
                    embeds: [embed],
                    files: file ? [file] : []
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`📊 Estatísticas da Guild: ${interaction.guild.name}`)
                .setThumbnail(interaction.guild.iconURL() || null)
                .addFields(
                    { name: '👥 Total Mineradores', value: guildData.total_users?.toString() || '0', inline: true },
                    { name: '⛏️ Total Minerações', value: guildData.total_mines?.toString() || '0', inline: true },
                    { name: '💎 Total Minerado', value: guildData.total_coins_mined || '0.00000000', inline: true },
                    { name: '🛒 Picaretas Vendidas', value: guildData.total_pickaxes_sold?.toString() || '0', inline: true },
                    { name: '💰 Coins Recebidos', value: guildData.total_coins_received || '0.00000000', inline: true },
                    { name: '💳 Card Server', value: guildData.server_card_id ? '✅ Configurado' : '❌ Não configurado', inline: true }
                )
                .setFooter({ text: 'Use /minerar para começar a minerar!' })
                .setTimestamp();

            const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
            
            await interaction.editReply({ 
                embeds: [embed],
                files: file ? [file] : []
            });
        }

    } catch (error) {
        console.error('❌ Erro:', error);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Ocorreu um erro.', ephemeral: true });
        } else {
            await interaction.editReply('❌ Ocorreu um erro.');
        }
    }
});

// ==================== REMINDER A CADA 1 HORA ====================
async function sendMiningReminders() {
    setInterval(async () => {
        for (const [guildId, guild] of client.guilds.cache) {
            try {
                // Procura canais de texto
                const textChannels = guild.channels.cache.filter(c => 
                    c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages')
                );

                if (textChannels.size === 0) continue;

                // Escolhe um canal aleatório
                const channel = textChannels.random();

                const embed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('⛏️ Hora de Minerar!')
                    .setDescription('Que tal ganhar algumas coins minerando?\nUse `/minerar` para começar!')
                    .addFields(
                        { name: '💰 Picaretas Disponíveis', value: 'Madeira, Pedra, Ouro, Ametista, Cobre, Ferro, Diamante, Titânio', inline: false },
                        { name: '🍞 Compre Pães', value: 'Use `/minerar shop-pao` para comprar pães e recuperar energia!', inline: false }
                    )
                    .setThumbnail('attachment://mine.png')
                    .setTimestamp();

                const file = await fs.pathExists(MINE_IMAGE) ? MINE_IMAGE : null;
                
                await channel.send({ 
                    embeds: [embed],
                    files: file ? [file] : []
                });

            } catch (error) {
                console.error(`Erro ao enviar reminder para guild ${guildId}:`, error);
            }
        }
    }, 60 * 60 * 1000); // 1 hora
}

// ==================== LIMPEZA DE CACHE ====================
setInterval(() => {
    const now = Date.now();
    for (const [key, data] of activeMines.entries()) {
        if (now > data.endTime + 60000) { // Remove após 1 minuto do fim
            activeMines.delete(key);
        }
    }
}, 60000); // Verifica a cada minuto

// ==================== INICIALIZAÇÃO ====================
client.once('ready', async () => {
    console.log(`✅ Bot de Mineração logado como ${client.user.tag}`);
    await initDatabase();
    await registerCommands();
    sendMiningReminders();
    
    console.log('🚀 Bot de Mineração pronto!');
    console.log('📊 Configurações:');
    console.log(`   - Picaretas: ${Object.keys(PICKAXES).length}`);
    console.log(`   - Pasta de imagens: ${IMAGES_PATH}`);
    console.log(`   - Cache de minerações ativas: ${activeMines.size}`);
});

client.login(TOKEN).catch(err => {
    console.error('❌ Erro ao fazer login:', err);
    process.exit(1);
});

// ==================== CLEANUP ====================
process.on('SIGINT', async () => {
    console.log('\n🛑 Encerrando...');
    console.log(`📊 Minerações ativas no cache: ${activeMines.size}`);
    if (db) await db.close();
    client.destroy();
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error);
});

module.exports = { client, paymentQueue, activeMines };
