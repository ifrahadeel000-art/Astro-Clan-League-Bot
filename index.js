require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
  ThreadAutoArchiveDuration,
} = require('discord.js');
const fs = require('fs');

// ─── Config ───────────────────────────────────────────────────────────────────
const TOKEN          = process.env.DISCORD_TOKEN;
const CLIENT_ID      = process.env.CLIENT_ID;
const GUILD_ID       = process.env.GUILD_ID;
const LEAGUE_CHANNEL = '1498804106628956211';
const SHOP_CHANNEL   = '1510600135862648952';
const HOST_ROLE      = '1459877884645740846';
const PING_ROLE      = '1451553808697266257';
const HICOM_ROLE     = '1460605334619029658';

// ── Level role IDs — fill these in with your actual Discord role IDs ──────────
const LEVEL_ROLES = [
  { points: 100,  roleId: 'ROLE_ID_LEVEL_1', label: 'LEVEL 1 - NOOB'     },
  { points: 250,  roleId: 'ROLE_ID_LEVEL_2', label: 'LEVEL 2 - BEGINNER'  },
  { points: 500,  roleId: 'ROLE_ID_LEVEL_3', label: 'LEVEL 3 - SEMI PRO'  },
  { points: 1000, roleId: 'ROLE_ID_LEVEL_4', label: 'LEVEL 4 - PRO'       },
  { points: 2500, roleId: 'ROLE_ID_LEVEL_5', label: 'LEVEL 5 - ELITE'     },
  { points: 5000, roleId: 'ROLE_ID_LEVEL_6', label: 'LEVEL 6 - LEGEND'    },
];

const FORMAT_CAPACITY = { '2v2': 4, '3v3': 6, '4v4': 8 };
const REGION_LABELS   = {
  europe:        'Europe',
  asia:          'Asia',
  north_america: 'North America',
  south_america: 'South America',
  oceania:       'Oceania',
};

// ─── Database ─────────────────────────────────────────────────────────────────
const DB_PATH = './database.json';

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      leagues: {}, points: {},
      shop: { enabled: false, panelMessageId: null, items: [
        { id: 'custom_role',  name: 'Custom Role',  price: 1000, stock: -1, description: 'A custom role in the server' },
        { id: 'colored_name', name: 'Colored Name',  price: 750,  stock: -1, description: 'A colored name role'         },
        { id: 'vip_access',   name: 'VIP Access',    price: 2000, stock: -1, description: 'Access to VIP channels'      },
      ]},
    }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ─── Points helpers ───────────────────────────────────────────────────────────
function getPoints(db, userId) {
  return db.points[userId] || 0;
}

function setPoints(db, userId, amount) {
  db.points[userId] = Math.max(0, amount);
}

function getLegs(points) {
  if (points < 5000) return 0;
  return Math.floor((points - 4000) / 1000);
}

function getCurrentLevel(points) {
  let level = null;
  for (const tier of LEVEL_ROLES) {
    if (points >= tier.points) level = tier;
  }
  return level;
}

async function syncRoles(guild, userId, points) {
  try {
    const member = await guild.members.fetch(userId);
    const currentLevel = getCurrentLevel(points);
    for (const tier of LEVEL_ROLES) {
      if (tier.roleId.startsWith('ROLE_ID')) continue;
      const role = guild.roles.cache.get(tier.roleId);
      if (!role) continue;
      if (currentLevel && currentLevel.points >= tier.points) {
        if (!member.roles.cache.has(tier.roleId)) await member.roles.add(role);
      } else {
        if (member.roles.cache.has(tier.roleId)) await member.roles.remove(role);
      }
    }
  } catch (err) {
    console.error('Role sync failed:', err);
  }
}

// ─── League embed builders ────────────────────────────────────────────────────
function buildLeagueEmbed(league) {
  const typeLabel  = league.type  === 'swift' ? 'Swift Game' : 'War Game';
  const perksLabel = league.perks === 'perks' ? 'Perks'      : 'No Perks';
  const playerList = league.players.map(id => `<@${id}>`).join(', ');

  return new EmbedBuilder()
    .setTitle('League Available')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Format',     value: league.format,                                    inline: true },
      { name: 'Match Type', value: typeLabel,                                        inline: true },
      { name: 'Perks',      value: perksLabel,                                       inline: true },
      { name: 'Region',     value: REGION_LABELS[league.region],                     inline: true },
      { name: 'Host',       value: `<@${league.hostId}>`,                            inline: true },
      { name: 'Spots Left', value: `${league.players.length} / ${league.capacity}`,  inline: true },
      { name: 'Players',    value: playerList || 'None',                             inline: false },
      { name: 'League ID',  value: `\`${league.id}\``,                               inline: false },
    )
    .setTimestamp();
}

function buildCancelledLeagueEmbed(league) {
  const typeLabel  = league.type  === 'swift' ? 'Swift Game' : 'War Game';
  const perksLabel = league.perks === 'perks' ? 'Perks'      : 'No Perks';
  const playerList = league.players.map(id => `<@${id}>`).join(', ');

  return new EmbedBuilder()
    .setTitle('League Cancelled')
    .setColor(0xe74c3c)
    .addFields(
      { name: 'Format',     value: league.format,                                    inline: true },
      { name: 'Match Type', value: typeLabel,                                        inline: true },
      { name: 'Perks',      value: perksLabel,                                       inline: true },
      { name: 'Region',     value: REGION_LABELS[league.region],                     inline: true },
      { name: 'Host',       value: `<@${league.hostId}>`,                            inline: true },
      { name: 'Spots Left', value: `${league.players.length} / ${league.capacity}`,  inline: true },
      { name: 'Players',    value: playerList || 'None',                             inline: false },
      { name: 'League ID',  value: `\`${league.id}\``,                               inline: false },
    )
    .setFooter({ text: 'This league has been cancelled.' })
    .setTimestamp();
}

function buildJoinRow(leagueId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_${leagueId}`)
      .setLabel('Join League')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

// ─── Shop helpers ─────────────────────────────────────────────────────────────
function buildShopPanelEmbed(shopEnabled) {
  if (!shopEnabled) {
    return new EmbedBuilder()
      .setTitle('League Shop')
      .setColor(0x57606f)
      .setDescription('The shop is currently **closed**.\nCheck back later.')
      .setTimestamp();
  }
  return new EmbedBuilder()
    .setTitle('League Shop')
    .setColor(0xf39c12)
    .setDescription('Click the button below to open the shop and spend your points on exclusive rewards.')
    .setTimestamp();
}

function buildShopPanelRow(shopEnabled) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_shop')
      .setLabel('Open League Shop')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!shopEnabled),
  );
}

function buildShopEmbed(db, userId) {
  const pts  = getPoints(db, userId);
  const legs = getLegs(pts);
  const level = getCurrentLevel(pts);

  const itemLines = db.shop.items.map(item => {
    const stockText = item.stock === -1 ? 'In Stock' : item.stock === 0 ? 'Out of Stock' : `${item.stock} left`;
    return `**${item.name}** — ${item.price} pts\n${item.description}  |  *${stockText}*`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setTitle('League Shop')
    .setColor(0xf39c12)
    .addFields(
      { name: 'Your Points', value: `${pts} pts`,              inline: true },
      { name: 'Legs',        value: `${legs}`,                  inline: true },
      { name: 'Level',       value: level ? level.label : 'Unranked', inline: true },
      { name: 'Available Items', value: itemLines || 'No items in the shop.', inline: false },
    )
    .setFooter({ text: 'Purchasing deducts points from your balance.' })
    .setTimestamp();
}

function buildShopBuyRows(db, userId) {
  const pts = getPoints(db, userId);
  const rows = [];
  const chunks = [];

  for (let i = 0; i < db.shop.items.length; i += 5) {
    chunks.push(db.shop.items.slice(i, i + 5));
  }

  for (const chunk of chunks) {
    const row = new ActionRowBuilder();
    for (const item of chunk) {
      const canAfford   = pts >= item.price;
      const inStock     = item.stock !== 0;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`buy_${item.id}`)
          .setLabel(`Buy ${item.name}`)
          .setStyle(canAfford && inStock ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(!canAfford || !inStock),
      );
    }
    rows.push(row);
    if (rows.length >= 4) break;
  }

  return rows;
}

// ─── Slash commands ───────────────────────────────────────────────────────────
const commands = [
  // League commands
  new SlashCommandBuilder()
    .setName('host-league')
    .setDescription('Host a new league')
    .addStringOption(o =>
      o.setName('format').setDescription('Match format').setRequired(true)
        .addChoices(
          { name: '2v2', value: '2v2' },
          { name: '3v3', value: '3v3' },
          { name: '4v4', value: '4v4' },
        ))
    .addStringOption(o =>
      o.setName('type').setDescription('Match type').setRequired(true)
        .addChoices(
          { name: 'Swift Game', value: 'swift' },
          { name: 'War Game',   value: 'war'   },
        ))
    .addStringOption(o =>
      o.setName('perks').setDescription('Match perks').setRequired(true)
        .addChoices(
          { name: 'Perks',    value: 'perks'    },
          { name: 'No Perks', value: 'no_perks' },
        ))
    .addStringOption(o =>
      o.setName('region').setDescription('Region').setRequired(true)
        .addChoices(
          { name: 'Europe',        value: 'europe'        },
          { name: 'Asia',          value: 'asia'          },
          { name: 'North America', value: 'north_america' },
          { name: 'South America', value: 'south_america' },
          { name: 'Oceania',       value: 'oceania'       },
        )),

  new SlashCommandBuilder()
    .setName('cancel-league')
    .setDescription('Cancel your hosted league')
    .addStringOption(o =>
      o.setName('id').setDescription('League ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('add-player')
    .setDescription('Add a player to your league')
    .addStringOption(o =>
      o.setName('id').setDescription('League ID').setRequired(true))
    .addUserOption(o =>
      o.setName('player').setDescription('Player to add').setRequired(true)),

  new SlashCommandBuilder()
    .setName('remove-player')
    .setDescription('Remove a player from your league')
    .addStringOption(o =>
      o.setName('id').setDescription('League ID').setRequired(true))
    .addUserOption(o =>
      o.setName('player').setDescription('Player to remove').setRequired(true)),

  // Points commands
  new SlashCommandBuilder()
    .setName('addpoints')
    .setDescription('Give points to a player (League Host only)')
    .addUserOption(o =>
      o.setName('user').setDescription('Player to give points to').setRequired(true))
    .addIntegerOption(o =>
      o.setName('amount').setDescription('Amount of points').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('removepoints')
    .setDescription('Remove points from a player (League Host only)')
    .addUserOption(o =>
      o.setName('user').setDescription('Player to remove points from').setRequired(true))
    .addIntegerOption(o =>
      o.setName('amount').setDescription('Amount of points').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName('resetpoints')
    .setDescription('Reset a player\'s points to zero (League Host only)')
    .addUserOption(o =>
      o.setName('user').setDescription('Player to reset').setRequired(true)),

  new SlashCommandBuilder()
    .setName('points')
    .setDescription('Check point balance')
    .addUserOption(o =>
      o.setName('user').setDescription('User to check (defaults to yourself)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('View the top point earners'),

  // Shop management (HICOM only)
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Manage the League Shop (HICOM only)')
    .addSubcommand(sub =>
      sub.setName('enable').setDescription('Enable the shop'))
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Disable the shop'))
    .addSubcommand(sub =>
      sub.setName('refresh').setDescription('Repost the shop panel in the shop channel')),

  new SlashCommandBuilder()
    .setName('addreward')
    .setDescription('Add a new item to the shop (HICOM only)')
    .addStringOption(o =>
      o.setName('name').setDescription('Item name').setRequired(true))
    .addIntegerOption(o =>
      o.setName('price').setDescription('Price in points').setRequired(true).setMinValue(1))
    .addStringOption(o =>
      o.setName('description').setDescription('Item description').setRequired(true))
    .addIntegerOption(o =>
      o.setName('stock').setDescription('Stock count (-1 = unlimited)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('editreward')
    .setDescription('Edit a shop item (HICOM only)')
    .addStringOption(o =>
      o.setName('id').setDescription('Item ID to edit').setRequired(true))
    .addStringOption(o =>
      o.setName('name').setDescription('New name (or "out of stock" to mark unavailable)').setRequired(false))
    .addIntegerOption(o =>
      o.setName('price').setDescription('New price').setRequired(false))
    .addIntegerOption(o =>
      o.setName('stock').setDescription('New stock (-1 = unlimited, 0 = out of stock)').setRequired(false))
    .addStringOption(o =>
      o.setName('description').setDescription('New description').setRequired(false)),
].map(c => c.toJSON());

// ─── Register commands ────────────────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Slash commands registered successfully.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', async () => {
  console.log(`Online as ${client.user.tag}`);
  await registerCommands();
});

// ─── Interactions ─────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  const { member, guild } = interaction;

  // ── Button: Join League ───────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('join_')) {
    const id     = interaction.customId.replace('join_', '');
    const db     = loadDB();
    const league = db.leagues[id];

    if (!league) return interaction.reply({ content: 'This league no longer exists.', ephemeral: true });
    if (league.players.includes(member.id)) return interaction.reply({ content: 'You are already in this league.', ephemeral: true });
    if (league.players.length >= league.capacity) return interaction.reply({ content: 'This league is full.', ephemeral: true });

    league.players.push(member.id);
    db.leagues[id] = league;
    saveDB(db);

    try {
      const thread = await guild.channels.fetch(league.threadId);
      if (thread) {
        await thread.members.add(member.id);
        await thread.send({ content: `<@${member.id}> has joined the league. (${league.players.length}/${league.capacity})` });
      }
    } catch (err) { console.error('Thread add failed:', err); }

    const isFull = league.players.length >= league.capacity;
    await interaction.update({
      embeds:     [buildLeagueEmbed(league)],
      components: [buildJoinRow(id, isFull)],
    });

    return interaction.followUp({ content: `You have joined league **${id}**. Check your private thread.`, ephemeral: true });
  }

  // ── Button: Open Shop ─────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === 'open_shop') {
    const db = loadDB();
    if (!db.shop.enabled) return interaction.reply({ content: 'The shop is currently closed.', ephemeral: true });

    const rows = buildShopBuyRows(db, member.id);
    return interaction.reply({
      embeds:     [buildShopEmbed(db, member.id)],
      components: rows,
      ephemeral:  true,
    });
  }

  // ── Button: Buy Item ──────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
    const itemId = interaction.customId.replace('buy_', '');
    const db     = loadDB();
    if (!db.shop.enabled) return interaction.reply({ content: 'The shop is currently closed.', ephemeral: true });

    const item = db.shop.items.find(i => i.id === itemId);
    if (!item) return interaction.reply({ content: 'That item no longer exists.', ephemeral: true });

    const pts = getPoints(db, member.id);
    if (pts < item.price) return interaction.reply({ content: `You need **${item.price} pts** but only have **${pts} pts**.`, ephemeral: true });
    if (item.stock === 0) return interaction.reply({ content: 'This item is out of stock.', ephemeral: true });

    setPoints(db, member.id, pts - item.price);
    if (item.stock > 0) item.stock -= 1;
    saveDB(db);

    await syncRoles(guild, member.id, getPoints(db, member.id));

    return interaction.reply({
      content: `**Purchase Successful**\nYou bought **${item.name}** for **${item.price} pts**.\nRemaining balance: **${getPoints(db, member.id)} pts**\n\nPlease open a ticket or contact a staff member to claim your reward.`,
      ephemeral: true,
    });
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // ── /host-league ──────────────────────────────────────────────────────────
  if (commandName === 'host-league') {
    if (interaction.channelId !== LEAGUE_CHANNEL) return interaction.reply({ content: `Leagues can only be hosted in <#${LEAGUE_CHANNEL}>.`, ephemeral: true });
    if (!member.roles.cache.has(HOST_ROLE)) return interaction.reply({ content: 'You do not have permission to host leagues.', ephemeral: true });

    const format = interaction.options.getString('format');
    const type   = interaction.options.getString('type');
    const perks  = interaction.options.getString('perks');
    const region = interaction.options.getString('region');
    const id     = generateId();

    const db = loadDB();
    const league = {
      id, format, type, perks, region,
      capacity:       FORMAT_CAPACITY[format],
      hostId:         member.id,
      players:        [member.id],
      threadId:       null,
      embedMessageId: null,
    };

    await interaction.deferReply({ ephemeral: true });

    const leagueChannel = await guild.channels.fetch(LEAGUE_CHANNEL);

    const embedMsg = await leagueChannel.send({
      embeds:     [buildLeagueEmbed(league)],
      components: [buildJoinRow(id)],
    });
    league.embedMessageId = embedMsg.id;

    await leagueChannel.send({ content: `<@&${PING_ROLE}> New league available: **${id}**` });

    const thread = await leagueChannel.threads.create({
      name:                `League ${id}`,
      type:                ChannelType.PrivateThread,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason:              `Private thread for league ${id}`,
      invitable:           false,
    });

    await thread.members.add(member.id);

    const typeLabel  = type  === 'swift' ? 'Swift Game' : 'War Game';
    const perksLabel = perks === 'perks' ? 'Perks'      : 'No Perks';

    await thread.send({ content: [`**League ${id} — Private Session**`, ``, `Host: <@${member.id}>`, `Format: ${format}  |  ${typeLabel}  |  ${perksLabel}  |  ${REGION_LABELS[region]}`, ``, `Waiting for players to join...`].join('\n') });

    league.threadId = thread.id;
    db.leagues[id]  = league;
    saveDB(db);

    return interaction.editReply({ content: `League **${id}** created. Your private thread is open.` });
  }

  // ── /cancel-league ────────────────────────────────────────────────────────
  if (commandName === 'cancel-league') {
    const id     = interaction.options.getString('id').toUpperCase();
    const db     = loadDB();
    const league = db.leagues[id];

    if (!league) return interaction.reply({ content: `No league found with ID **${id}**.`, ephemeral: true });
    if (!member.roles.cache.has(HOST_ROLE)) return interaction.reply({ content: 'You do not have permission to cancel leagues.', ephemeral: true });
    if (league.hostId !== member.id) return interaction.reply({ content: 'You can only cancel leagues that you are hosting.', ephemeral: true });

    try {
      const thread = await guild.channels.fetch(league.threadId);
      if (thread) await thread.delete();
    } catch (err) { console.error('Thread delete failed:', err); }

    try {
      const leagueChannel = await guild.channels.fetch(LEAGUE_CHANNEL);
      const embedMsg      = await leagueChannel.messages.fetch(league.embedMessageId);
      await embedMsg.edit({ embeds: [buildCancelledLeagueEmbed(league)], components: [buildJoinRow(id, true)] });
    } catch (err) { console.error('Embed update failed:', err); }

    delete db.leagues[id];
    saveDB(db);

    return interaction.reply({ content: `**League Cancelled**\nLeague **${id}** hosted by <@${member.id}> has been cancelled.` });
  }

  // ── /add-player ───────────────────────────────────────────────────────────
  if (commandName === 'add-player') {
    const id     = interaction.options.getString('id').toUpperCase();
    const target = interaction.options.getUser('player');
    const db     = loadDB();
    const league = db.leagues[id];

    if (!league) return interaction.reply({ content: `No league found with ID **${id}**.`, ephemeral: true });
    if (league.hostId !== member.id) return interaction.reply({ content: 'Only the league host can add players.', ephemeral: true });
    if (league.players.includes(target.id)) return interaction.reply({ content: `<@${target.id}> is already in this league.`, ephemeral: true });
    if (league.players.length >= league.capacity) return interaction.reply({ content: 'The league is already full.', ephemeral: true });

    league.players.push(target.id);
    db.leagues[id] = league;
    saveDB(db);

    try {
      const thread = await guild.channels.fetch(league.threadId);
      if (thread) { await thread.members.add(target.id); await thread.send({ content: `<@${target.id}> was added to the league by the host. (${league.players.length}/${league.capacity})` }); }
    } catch (err) { console.error('Thread add failed:', err); }

    const isFull = league.players.length >= league.capacity;
    try {
      const leagueChannel = await guild.channels.fetch(LEAGUE_CHANNEL);
      const embedMsg      = await leagueChannel.messages.fetch(league.embedMessageId);
      await embedMsg.edit({ embeds: [buildLeagueEmbed(league)], components: [buildJoinRow(league.id, isFull)] });
    } catch (err) { console.error('Embed update failed:', err); }

    return interaction.reply({ content: `<@${target.id}> has been added to league **${id}**.`, ephemeral: true });
  }

  // ── /remove-player ────────────────────────────────────────────────────────
  if (commandName === 'remove-player') {
    const id     = interaction.options.getString('id').toUpperCase();
    const target = interaction.options.getUser('player');
    const db     = loadDB();
    const league = db.leagues[id];

    if (!league) return interaction.reply({ content: `No league found with ID **${id}**.`, ephemeral: true });
    if (league.hostId !== member.id) return interaction.reply({ content: 'Only the league host can remove players.', ephemeral: true });
    if (target.id === league.hostId) return interaction.reply({ content: 'The host cannot be removed from the league.', ephemeral: true });
    if (!league.players.includes(target.id)) return interaction.reply({ content: `<@${target.id}> is not in this league.`, ephemeral: true });

    league.players = league.players.filter(p => p !== target.id);
    db.leagues[id] = league;
    saveDB(db);

    try {
      const thread = await guild.channels.fetch(league.threadId);
      if (thread) { await thread.members.remove(target.id); await thread.send({ content: `<@${target.id}> was removed from the league by the host. (${league.players.length}/${league.capacity})` }); }
    } catch (err) { console.error('Thread remove failed:', err); }

    try {
      const leagueChannel = await guild.channels.fetch(LEAGUE_CHANNEL);
      const embedMsg      = await leagueChannel.messages.fetch(league.embedMessageId);
      await embedMsg.edit({ embeds: [buildLeagueEmbed(league)], components: [buildJoinRow(league.id, false)] });
    } catch (err) { console.error('Embed update failed:', err); }

    return interaction.reply({ content: `<@${target.id}> has been removed from league **${id}**.`, ephemeral: true });
  }

  // ── /addpoints ────────────────────────────────────────────────────────────
  if (commandName === 'addpoints') {
    if (!member.roles.cache.has(HOST_ROLE)) return interaction.reply({ content: 'You do not have permission to give points.', ephemeral: true });

    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const db     = loadDB();

    const before = getPoints(db, target.id);
    setPoints(db, target.id, before + amount);
    saveDB(db);

    await syncRoles(guild, target.id, getPoints(db, target.id));

    const after = getPoints(db, target.id);
    const level = getCurrentLevel(after);

    return interaction.reply({
      content: `**Points Added**\n<@${target.id}> has been given **${amount} pts**.\nNew balance: **${after} pts**${level ? `  |  ${level.label}` : ''}`,
    });
  }

  // ── /removepoints ─────────────────────────────────────────────────────────
  if (commandName === 'removepoints') {
    if (!member.roles.cache.has(HOST_ROLE)) return interaction.reply({ content: 'You do not have permission to remove points.', ephemeral: true });

    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const db     = loadDB();

    const before = getPoints(db, target.id);
    setPoints(db, target.id, before - amount);
    saveDB(db);

    await syncRoles(guild, target.id, getPoints(db, target.id));

    const after = getPoints(db, target.id);
    return interaction.reply({
      content: `**Points Removed**\n**${amount} pts** deducted from <@${target.id}>.\nNew balance: **${after} pts**`,
    });
  }

  // ── /resetpoints ──────────────────────────────────────────────────────────
  if (commandName === 'resetpoints') {
    if (!member.roles.cache.has(HOST_ROLE)) return interaction.reply({ content: 'You do not have permission to reset points.', ephemeral: true });

    const target = interaction.options.getUser('user');
    const db     = loadDB();

    setPoints(db, target.id, 0);
    saveDB(db);

    await syncRoles(guild, target.id, 0);

    return interaction.reply({ content: `**Points Reset**\n<@${target.id}>'s points have been reset to **0 pts**.` });
  }

  // ── /points ───────────────────────────────────────────────────────────────
  if (commandName === 'points') {
    const target = interaction.options.getUser('user') || interaction.user;
    const db     = loadDB();
    const pts    = getPoints(db, target.id);
    const legs   = getLegs(pts);
    const level  = getCurrentLevel(pts);

    const embed = new EmbedBuilder()
      .setTitle(`${target.username}'s Points`)
      .setColor(0x5865f2)
      .addFields(
        { name: 'Points', value: `${pts} pts`,                     inline: true },
        { name: 'Level',  value: level ? level.label : 'Unranked', inline: true },
        { name: 'Legs',   value: String(legs),                     inline: true },
      )
      .setThumbnail(target.displayAvatarURL())
      .setTimestamp();

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── /leaderboard ──────────────────────────────────────────────────────────
  if (commandName === 'leaderboard') {
    const db      = loadDB();
    const entries = Object.entries(db.points)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    if (entries.length === 0) {
      return interaction.reply({ content: 'No points have been awarded yet.', ephemeral: true });
    }

    const lines = entries.map(([userId, pts], i) => {
      const legs  = getLegs(pts);
      const level = getCurrentLevel(pts);
      const legsText = legs > 0 ? ` | ${legs} Leg${legs !== 1 ? 's' : ''}` : '';
      return `**${i + 1}.** <@${userId}> — **${pts} pts**${level ? `  |  ${level.label}` : ''}${legsText}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setTitle('Leaderboard — Top Point Earners')
      .setColor(0xf39c12)
      .setDescription(lines)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ── /shop ─────────────────────────────────────────────────────────────────
  if (commandName === 'shop') {
    if (!member.roles.cache.has(HICOM_ROLE)) return interaction.reply({ content: 'Only HICOM can manage the shop.', ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const db  = loadDB();

    // Shared helper: post a fresh panel or update the existing one
    async function postOrUpdatePanel(enabled) {
      const shopChannel = await guild.channels.fetch(SHOP_CHANNEL);
      let panelMsg = null;

      // Try to fetch existing panel
      if (db.shop.panelMessageId) {
        try {
          panelMsg = await shopChannel.messages.fetch(db.shop.panelMessageId);
        } catch (err) {
          panelMsg = null; // message was deleted, will repost
        }
      }

      if (panelMsg) {
        await panelMsg.edit({
          embeds:     [buildShopPanelEmbed(enabled)],
          components: [buildShopPanelRow(enabled)],
        });
      } else {
        // Delete old id if stale, then post fresh
        panelMsg = await shopChannel.send({
          embeds:     [buildShopPanelEmbed(enabled)],
          components: [buildShopPanelRow(enabled)],
        });
        db.shop.panelMessageId = panelMsg.id;
        saveDB(db);
      }
    }

    if (sub === 'enable') {
      db.shop.enabled = true;
      saveDB(db);
      await postOrUpdatePanel(true);
      return interaction.reply({ content: 'The shop is now **open**. The panel has been posted in the shop channel.', ephemeral: true });
    }

    if (sub === 'disable') {
      db.shop.enabled = false;
      saveDB(db);
      await postOrUpdatePanel(false);
      return interaction.reply({ content: 'The shop is now **closed**. The panel has been updated.', ephemeral: true });
    }

    if (sub === 'refresh') {
      const shopChannel = await guild.channels.fetch(SHOP_CHANNEL);

      // Always delete old panel and repost fresh
      if (db.shop.panelMessageId) {
        try {
          const old = await shopChannel.messages.fetch(db.shop.panelMessageId);
          await old.delete();
        } catch (err) { /* already gone */ }
      }

      const panelMsg = await shopChannel.send({
        embeds:     [buildShopPanelEmbed(db.shop.enabled)],
        components: [buildShopPanelRow(db.shop.enabled)],
      });

      db.shop.panelMessageId = panelMsg.id;
      saveDB(db);

      return interaction.reply({ content: 'Shop panel has been reposted in the shop channel.', ephemeral: true });
    }
  }

  // ── /addreward ────────────────────────────────────────────────────────────
  if (commandName === 'addreward') {
    if (!member.roles.cache.has(HICOM_ROLE)) return interaction.reply({ content: 'Only HICOM can manage shop rewards.', ephemeral: true });

    const name        = interaction.options.getString('name');
    const price       = interaction.options.getInteger('price');
    const description = interaction.options.getString('description');
    const stock       = interaction.options.getInteger('stock') ?? -1;
    const db          = loadDB();

    const id = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').substring(0, 20) + '_' + Date.now().toString(36);
    db.shop.items.push({ id, name, price, stock, description });
    saveDB(db);

    return interaction.reply({ content: `Reward **${name}** (${price} pts) added to the shop with ID \`${id}\`.`, ephemeral: true });
  }

  // ── /editreward ───────────────────────────────────────────────────────────
  if (commandName === 'editreward') {
    if (!member.roles.cache.has(HICOM_ROLE)) return interaction.reply({ content: 'Only HICOM can manage shop rewards.', ephemeral: true });

    const itemId = interaction.options.getString('id');
    const db     = loadDB();
    const item   = db.shop.items.find(i => i.id === itemId);

    if (!item) return interaction.reply({ content: `No shop item found with ID \`${itemId}\`. Use /addreward to add new items.`, ephemeral: true });

    const newName  = interaction.options.getString('name');
    const newPrice = interaction.options.getInteger('price');
    const newStock = interaction.options.getInteger('stock');
    const newDesc  = interaction.options.getString('description');

    if (newName  !== null) item.name        = newName;
    if (newPrice !== null) item.price       = newPrice;
    if (newStock !== null) item.stock       = newStock;
    if (newDesc  !== null) item.description = newDesc;

    saveDB(db);
    return interaction.reply({ content: `Reward **${item.name}** has been updated.`, ephemeral: true });
  }
});

client.login(TOKEN);
