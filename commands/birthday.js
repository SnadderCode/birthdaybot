// commands/birthday.js
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags} = require('discord.js');
const dayjs = require('dayjs');
const { loadData, saveData } = require('../utils/data');
const { generateBirthdayMessage } = require('../utils/generateMessage');

const DATA_FILE = process.env.DATA_FILE || './data/birthdays.json';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Bursdagskommandoer')
    .addSubcommand(s =>
      s.setName('set')
        .setDescription('Sett en brukers bursdag')
        .addUserOption(o => o.setName('user').setDescription('Bruker').setRequired(true))
        .addStringOption(o => o.setName('date').setDescription('Dato YYYY-MM-DD').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription('List alle registrerte bursdager på denne serveren')
    )
    .addSubcommand(s =>
      s.setName('next')
        .setDescription('Vis neste bursdager (standard 5)')
        .addIntegerOption(o => o.setName('count').setDescription('Hvor mange').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('remove')
        .setDescription('Fjern en brukers bursdag')
        .addUserOption(o => o.setName('user').setDescription('Bruker').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('channel')
        .setDescription('Sett bursdagskanal for denne serveren')
        .addChannelOption(o => o.setName('channel').setDescription('Kanal').setRequired(true))
    )
    .addSubcommand(s =>
      s.setName('role')
        .setDescription('Sett rolle som skal pinges ved bursdagsmelding')
        .addRoleOption(o => o.setName('role').setDescription('Rolle').setRequired(false))
    )
    .addSubcommand(s =>
      s.setName('test')
        .setDescription('Send testbursdagsmelding til konfigurert kanal')
    )
    .addSubcommand(s =>
      s.setName('whitelist')
        .setDescription('Administrer whitelisted servers (legg til/fjern) - kun admins')
        .addStringOption(o => o.setName('action').setDescription('add/remove').setRequired(true))
    ),

  async execute(interaction, { client, DATA_FILE: externalDataFile }) {
    const dataFile = externalDataFile || DATA_FILE;
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'set') {
        const user = interaction.options.getUser('user', true);
        const date = interaction.options.getString('date', true);
        // validate date format YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return interaction.reply({ content: 'Ugyldig datoformat. Bruk YYYY-MM-DD.', flags: MessageFlags.Ephemeral });
        }
        const parsed = dayjs(date, 'YYYY-MM-DD', true);
        if (!parsed.isValid()) {
          return interaction.reply({ content: 'Ugyldig dato — ikke en korrekt dato.', flags: MessageFlags.Ephemeral });
        }

        const data = loadData(dataFile);
        data.birthdays = data.birthdays || [];

        // remove any existing for this user in this guild
        data.birthdays = data.birthdays.filter(b => !(b.Userid === user.id && b.ServerId === interaction.guildId));

        data.birthdays.push({
          Userid: user.id,
          Username: user.username,
          Dato: date,
          ServerId: interaction.guildId
        });

        saveData(dataFile, data);
        return interaction.reply({ content: `Bursdag lagret for ${user.tag} — ${date}`, flags: MessageFlags.Ephemeral });

      } else if (sub === 'list') {
        const data = loadData(dataFile);
        const list = (data.birthdays || []).filter(b => b.ServerId === interaction.guildId);
        if (list.length === 0) return interaction.reply({ content: 'Ingen bursdager registrert på denne serveren.', flags: MessageFlags.Ephemeral });

        // filter to still-present members
        const lines = [];
        for (const b of list) {
          try {
            const member = await interaction.guild.members.fetch(b.Userid).catch(() => null);
            if (!member) continue;
            lines.push(`${member.user.tag} — ${b.Dato}`);
          } catch (err) {
            console.error('Error fetching member for list:', err);
          }
        }
        if (lines.length === 0) return interaction.reply({ content: 'Ingen registrerte bursdager hvor brukeren fortsatt er på serveren.', flags: MessageFlags.Ephemeral });

        return interaction.reply({ content: `Registrerte bursdager:\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });

      } else if (sub === 'next') {
        const count = interaction.options.getInteger('count') || 5;
        const data = loadData(dataFile);
        const list = (data.birthdays || []).filter(b => b.ServerId === interaction.guildId);
        if (list.length === 0) return interaction.reply({ content: 'Ingen bursdager registrert på denne serveren.', flags: MessageFlags.Ephemeral });
        // compute next upcoming by month/day relative to today
        const today = dayjs();
        const expanded = [];
        for (const b of list) {
          try {
            const member = await interaction.guild.members.fetch(b.Userid).catch(() => null);
            if (!member) continue;
            const birth = dayjs(b.Dato, 'YYYY-MM-DD');
            // build next birthday date (this year or next)
            let next = birth.year(today.year());
            next = dayjs(`${today.year()}-${birth.format('MM-DD')}`, 'YYYY-MM-DD');
            if (next.isBefore(today, 'day')) next = next.add(1, 'year');
            const age = next.year() - birth.year();
            expanded.push({ next, age, tag: member.user.tag, userId: b.Userid, date: b.Dato });
          } catch (err) {
            console.error('Error in next computation:', err);
          }
        }
        if (expanded.length === 0) return interaction.reply({ content: 'Ingen gyldige bursdager funnet (brukere ikke funnet).', flags: MessageFlags.Ephemeral });
        expanded.sort((a, b) => a.next.valueOf() - b.next.valueOf());
        const out = expanded.slice(0, count).map(e => `${e.next.format('YYYY-MM-DD')} — ${e.tag} — fyller ${e.age}`).join('\n');
        return interaction.reply({ content: `Neste bursdager:\n${out}`, flags: MessageFlags.Ephemeral });

      } else if (sub === 'remove') {
        const user = interaction.options.getUser('user', true);
        const data = loadData(dataFile);
        const before = (data.birthdays || []).length;
        data.birthdays = (data.birthdays || []).filter(b => !(b.Userid === user.id && b.ServerId === interaction.guildId));
        saveData(dataFile, data);
        const after = (data.birthdays || []).length;
        if (after < before) {
          return interaction.reply({ content: `Bursdag for ${user.tag} ble fjernet.`, flags: MessageFlags.Ephemeral });
        } else {
          return interaction.reply({ content: `Fant ingen bursdag for ${user.tag} på denne serveren.`, flags: MessageFlags.Ephemeral });
        }

      } else if (sub === 'channel') {
        // admin permission required to set channel
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'Du trenger Manage Server for å endre bursdagskanal.', flags: MessageFlags.Ephemeral });
        }
        const channel = interaction.options.getChannel('channel', true);
        const data = loadData(dataFile);
        data.servers = data.servers || {};
        data.servers[interaction.guildId] = data.servers[interaction.guildId] || {};
        data.servers[interaction.guildId].channelId = channel.id;
        saveData(dataFile, data);
        return interaction.reply({ content: `Bursdagskanal satt til ${channel.name}`, flags: MessageFlags.Ephemeral });

      } else if (sub === 'role') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'Du trenger Manage Server for å endre bursdagsrolle.', flags: MessageFlags.Ephemeral });
        }
        const role = interaction.options.getRole('role');
        const data = loadData(dataFile);
        data.servers = data.servers || {};
        data.servers[interaction.guildId] = data.servers[interaction.guildId] || {};
        data.servers[interaction.guildId].roleId = role ? role.id : null;
        saveData(dataFile, data);
        return interaction.reply({ content: role ? `Bursdagsrolle satt til ${role.name}` : 'Bursdagsrolle fjernet', flags: MessageFlags.Ephemeral });

      } else if (sub === 'test') {
        const data = loadData(dataFile);
        const settings = (data.servers && data.servers[interaction.guildId]) || {};
        const channelId = settings.channelId;
        const roleId = settings.roleId;

        if (!channelId) return interaction.reply({ content: 'Bursdagskanal ikke satt for denne serveren. Bruk /birthday channel #kanal', flags: MessageFlags.Ephemeral });

        const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased?.()) return interaction.reply({ content: 'Kunne ikke finne kanalen eller kanalen er ikke tekstkanal.', flags: MessageFlags.Ephemeral });

        // Build a sample message, using generateBirthdayMessage
        const sampleLines = [`Eksempelbruker (test) fyller X år i dag!`];
        const body = await generateBirthdayMessage(sampleLines).catch(err => {
          console.error('generateBirthdayMessage failed (test):', err);
          return sampleLines.join('\n') + '\nGratulerer!';
        });

        let final = `**Testbursdagsmelding**\n\n${body}`;
        if (roleId) final = `<@&${roleId}> ${final}`;

        try {
          await channel.send({ content: final });
          return interaction.reply({ content: `Testmelding sendt til <#${channelId}>.`, flags: MessageFlags.Ephemeral });
        } catch (err) {
          console.error('Failed to send test message:', err);
          return interaction.reply({ content: 'Feil ved sending av testmelding. Sjekk bot-permisjoner.', flags: MessageFlags.Ephemeral });
        }

      } else if (sub === 'whitelist') {
        // restricted: only ManageGuild
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'Du trenger Manage Server for å kunne endre whitelist.', flags: MessageFlags.Ephemeral });
        }
        const action = interaction.options.getString('action', true).toLowerCase();
        const data = loadData(dataFile);
        data.whitelistedServers = data.whitelistedServers || [];
        if (action === 'add') {
          if (!data.whitelistedServers.includes(interaction.guildId)) data.whitelistedServers.push(interaction.guildId);
          saveData(dataFile, data);
          return interaction.reply({ content: 'Denne serveren er nå whitelisted for bursdagsmeldinger.', flags: MessageFlags.Ephemeral });
        } else if (action === 'remove') {
          data.whitelistedServers = data.whitelistedServers.filter(id => id !== interaction.guildId);
          saveData(dataFile, data);
          return interaction.reply({ content: 'Denne serveren er fjernet fra whitelist.', flags: MessageFlags.Ephemeral });
        } else {
          return interaction.reply({ content: 'Ugyldig action — bruk add eller remove.', flags: MessageFlags.Ephemeral });
        }
      } else {
        return interaction.reply({ content: 'Ukjent subkommando.', flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      console.error('Error in birthday command:', err);
      try {
        return interaction.reply({ content: 'En feil oppsto under utføring av kommandoen.', flags: MessageFlags.Ephemeral });
      } catch { /* ignore */ }
    }
  }
};
