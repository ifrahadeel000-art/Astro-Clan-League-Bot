require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
} = require('discord.js');
const fs = require('fs');

// ─── Config ───────────────────────────────────────────────────────────────────
const TOKEN            = process.env.DISCORD_TOKEN;
const CLIENT_ID        = process.env.CLIENT_ID;
const GUILD_ID         = process.env.GUILD_ID;
const LEAGUE_CHANNEL   = '1498804106628956211';
const HOST_ROLE        = '1459877884645740846';
const PING_ROLE        = '1451553808697266257';

const FORMAT_CAPACITY  = { '2v2': 4, '3v3': 6, '4v4': 8 };
const REGION_LABELS    = {
  europe:        'Europe',
  asia:          'Asia',
  north_america: 'North America',
  south_america: 'South America',
  oceania:       'Oceania',
};

// ─── Database ─────────────────────────────────────────────────────────────────
const DB_PATH = './database.json';

function loadDB() {
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ leagues: {} }, null, 2));
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function generateLeagueId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ─── Slash commands ───────────────────────────────────────────────────────────
const commands = [
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
    .setName('join-league')
    .setDescription('Join an open league')
    .addStringOption(o =>
      o.setName('id').setDescription('League ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('cancel-league')
    .setDescription('Cancel your league')
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
].map(c => c.toJSON());

// ─── Register commands ────────────────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// ─── Build league embed ───────────────────────────────────────────────────────
function buildEmbed(league) {
  const spots     = league.capacity - league.players.length;
  const typeLabel = league.type === 'swift' ? 'Swift Game' : 'War Game';
  const perksLabel = league.perks === 'perks' ? 'Perks' : 'No Perks';

  return new EmbedBuilder()
    .setTitle('League Open')
    .setColor(0x2b2d31)
    .addFields(
      { name: 'League ID',    value: league.id,                      inline: true  },
      { name: 'Format',       value: league.format,                  inline: true  },
      { name: 'Match Type',   value: typeLabel,                      inline: true  },
      { name: 'Perks',        value: perksLabel,                     inline: true  },
      { name: 'Region',       value: REGION_LABELS[league.region],   inline: true  },
      { name: 'Host',         value: `<@${league.hostId}>`,          inline: true  },
      { name: 'Players',      value: `${league.players.length} / ${league.capacity}`, inline: true },
      { name: 'Spots Left',   value: String(spots),                  inline: true  },
    )
    .setFooter({ text: `Use /join-league id:${league.id} to join` })
    .setTimestamp();
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
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

// ─── Interaction handler ──────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild, channel } = interaction;

  // ── /host-league ──────────────────────────────────────────────────────────
  if (commandName === 'host-league') {

    if (channel.id !== LEAGUE_CHANNEL) {
      return interaction.reply({ content: 'Leagues can only be hosted in <#' + LEAGUE_CHANNEL + '>.', ephemeral: true });
    }

    if (!member.roles.cache.has(HOST_ROLE)) {
      return interaction.reply({ content: 'You do not have permission to host leagues.', ephemeral: true });
    }

    const format = interaction.options.getString('format');
    const type   = interaction.options.getString('type');
    const perks  = interaction.options.getString('perks');
    const region = interaction.options.getString('region');
    const id     = generateLeagueId();

    const db      = loadDB();
    const league  = {
      id,
      format,
      type,
      perks,
      region,
      capacity: FORMAT_CAPACITY[format],
      hostId:   member.id,
      players:  [member.id],
      threadId: null,
      embedMessageId: null,
    };

    // Post the public embed first so we can store the message id
    await interaction.deferReply();
    const embedMsg = await interaction.editReply({
      content: `<@&${PING_ROLE}> — A new league is open!`,
      embeds: [buildEmbed(league)],
    });

    league.embedMessageId = embedMsg.id;

    // Create private thread on the embed message
    const thread = await embedMsg.startThread({
      name:                `League ${id}`,
      type:                ChannelType.PrivateThread,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason:              `Private thread for league ${id}`,
    });

    // Add the host to the thread
    await thread.members.add(member.id);

    await thread.send({
      content: `League **${id}** private session started.\n\nHost: <@${member.id}>\nFormat: ${format} | ${type === 'swift' ? 'Swift Game' : 'War Game'} | ${perks === 'perks' ? 'Perks' : 'No Perks'} | ${REGION_LABELS[region]}\n\nWaiting for players to join...`,
    });

    league.threadId = thread.id;
    db.leagues[id]  = league;
    saveDB(db);

    return;
  }

  // ── /join-league ──────────────────────────────────────────────────────────
  if (commandName === 'join-league') {
    const id = interaction.options.getString('id').toUpperCase();
    const db = loadDB();
    const league = db.leagues[id];

    if (!league) {
      return interaction.reply({ content: `No league found with ID **${id}**.`, ephemeral: true });
    }

    if (league.players.includes(member.id)) {
      return interaction.reply({ content: 'You are already in this league.', ephemeral: true });
    }

    if (league.players.length >= league.capacity) {
      return interaction.reply({ content: 'This league is full.', ephemeral: true });
    }

    league.players.push(member.id);
    db.leagues[id] = league;
    saveDB(db);

    // Add player to private thread
    try {
      const thread = await guild.channels.fetch(league.threadId);
      if (thread) {
        await thread.members.add(member.id);
        await thread.send({ content: `<@${member.id}> has joined the league. (${league.players.length}/${league.capacity})` });
      }
    } catch (err) {
      console.error('Could not add player to thread:', err);
    }

    // Update the embed
    try {
      const leagueChannel = await guild.channels.fetch(LEAGUE_CHANNEL);
      const embedMsg = await leagueChannel.messages.fetch(league.embedMessageId);
      await embedMsg.edit({ embeds: [buildEmbed(league)] });
    } catch (err) {
      console.error('Could not update embed:', err);
    }

    return interaction.reply({ content: `You have joined league **${id}**. Check the private thread.`, ephemeral: true });
  }

  // ── /cancel-league ────────────────────────────────────────────────────────
  if (commandName === 'cancel-league') {
    const id = interaction.options.getString('id').toUpperCase();
    const db = loadDB();
    const league = db.leagues[id];

    if (!league) {
      return interaction.reply({ content: `No league found with ID **${id}**.`, ephemeral: true });
    }

    if (!member.roles.cache.has(HOST_ROLE)) {
      return interaction.reply({ content: 'You do not have permission to cancel leagues.', ephemeral: true });
    }

    if (league.hostId !== member.id) {
      return interaction.reply({ content: 'You can only cancel leagues that you are hosting.', ephemeral: true });
    }

    // Delete private thread
    try {
      const thread = await guild.channels.fetch(league.threadId);
      if (thread) await thread.delete('League cancelled');
    } catch (err) {
      console.error('Could not delete thread:', err);
    }

    // Delete the embed message
    try {
      const leagueChannel = await guild.channels.fetch(LEAGUE_CHANNEL);
      const embedMsg = await leagueChannel.messages.fetch(league.embedMessageId);
      if (embedMsg) await embedMsg.delete();
    } catch (err) {
      console.error('Could not delete embed message:', err);
    }

    delete db.leagues[id];
    saveDB(db);

    // Public cancellation notice (visible to everyone)
    return interaction.reply({
      content: `**League Cancelled**\nLeague **${id}** hosted by <@${member.id}> has been cancelled.`,
    });
  }

  // ── /add-player ───────────────────────────────────────────────────────────
  if (commandName === 'add-player') {
    const id     = interaction.options.getString('id').toUpperCase();
    const target = interaction.options.getUser('player');
    const db     = loadDB();
    const league = db.leagues[id];

    if (!league) {
      return interaction.reply({ content: `No league found with ID **${id}**.`, ephemeral: true });
    }

    if (league.hostId !== member.id) {
      return interaction.reply({ content: 'Only the league host can add players.', ephemeral: true });
    }

    if (league.players.includes(target.id)) {
      return interaction.reply({ content: `<@${target.id}> is already in this league.`, ephemeral: true });
    }

    if (league.players.length >= league.capacity) {
      return interaction.reply({ content: 'The league is already full.', ephemeral: true });
    }

    league.players.push(target.id);
    db.leagues[id] = league;
    saveDB(db);

    // Add to thread
    try {
      const thread = await guild.channels.fetch(league.threadId);
      if (thread) {
        await thread.members.add(target.id);
        await thread.send({ content: `<@${target.id}> was added to the league by the host. (${league.players.length}/${league.capacity})` });
      }
    } catch (err) {
      console.error('Could not add player to thread:', err);
    }

    // Update embed
    try {
      const leagueChannel = await guild.channels.fetch(LEAGUE_CHANNEL);
      const embedMsg = await leagueChannel.messages.fetch(league.embedMessageId);
      await embedMsg.edit({ embeds: [buildEmbed(league)] });
    } catch (err) {
      console.error('Could not update embed:', err);
    }

    return interaction.reply({ content: `<@${target.id}> has been added to league **${id}**.`, ephemeral: true });
  }

  // ── /remove-player ────────────────────────────────────────────────────────
  if (commandName === 'remove-player') {
    const id     = interaction.options.getString('id').toUpperCase();
    const target = interaction.options.getUser('player');
    const db     = loadDB();
    const league = db.leagues[id];

    if (!league) {
      return interaction.reply({ content: `No league found with ID **${id}**.`, ephemeral: true });
    }

    if (league.hostId !== member.id) {
      return interaction.reply({ content: 'Only the league host can remove players.', ephemeral: true });
    }

    if (target.id === league.hostId) {
      return interaction.reply({ content: 'The host cannot be removed from the league.', ephemeral: true });
    }

    if (!league.players.includes(target.id)) {
      return interaction.reply({ content: `<@${target.id}> is not in this league.`, ephemeral: true });
    }

    league.players = league.players.filter(p => p !== target.id);
    db.leagues[id] = league;
    saveDB(db);

    // Remove from thread
    try {
      const thread = await guild.channels.fetch(league.threadId);
      if (thread) {
        await thread.members.remove(target.id);
        await thread.send({ content: `<@${target.id}> was removed from the league by the host. (${league.players.length}/${league.capacity})` });
      }
    } catch (err) {
      console.error('Could not remove player from thread:', err);
    }

    // Update embed
    try {
      const leagueChannel = await guild.channels.fetch(LEAGUE_CHANNEL);
      const embedMsg = await leagueChannel.messages.fetch(league.embedMessageId);
      await embedMsg.edit({ embeds: [buildEmbed(league)] });
    } catch (err) {
      console.error('Could not update embed:', err);
    }

    return interaction.reply({ content: `<@${target.id}> has been removed from league **${id}**.`, ephemeral: true });
  }
});

client.login(TOKEN);
