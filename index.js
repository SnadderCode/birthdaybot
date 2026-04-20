// index.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials, MessageFlags } = require('discord.js');
const schedule = require('node-schedule');
const dayjs = require('dayjs');
const { loadData, saveData } = require('./utils/data');
const now = dayjs();

const DATA_FILE = process.env.DATA_FILE || './data/birthdays.json';
const TIMEZONE = process.env.TIMEZONE || 'UTC'; // change to 'Europe/Oslo' in .env if desired

function dayjsToCron(time) {
  const second = time.second();
  const minute = time.minute();
  const hour = time.hour();
  // day-of-month, month, weekday -> every day
  return `${second} ${minute} ${hour} * * *`;
}


const serverTIME = now.hour(16).minute(1).second(0)
const serverTIME_str = `${serverTIME.hour().toString().padStart(2, "0")}:${serverTIME.minute().toString().padStart(2, "0")}`;
const cronString = dayjsToCron(serverTIME);


const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.User, Partials.GuildMember]
});

client.commands = new Collection();

// load commands from commands folder
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
  for (const file of commandFiles) {
    const cmd = require(`./commands/${file}`);
    if (cmd.data && cmd.execute) {
      client.commands.set(cmd.data.name, cmd);
    }
  }
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // ensure data file exists
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify({ birthdays: [], servers: {}, whitelistedServers: [], lastSent: {} }, null, 2));
    }
  } catch (err) {
    console.error('Failed to ensure data file exists:', err);
  }

  // Schedule daily job at 09:00 server time
  // Cron: 0 9 * * * -> At 09:00 every day
  schedule.scheduleJob(cronString, async () => {
    console.log(`Running daily birthday job at ${serverTIME_str} server time`);
    await runDailyBirthdayJob();
  });

  // If bot starts after 09:00, run check/send for today if not already sent.
  (async () => {
    if (now.isAfter(serverTIME)) {
      console.log(`Bot started after ${serverTIME_str} — checking whether to send today\'s messages`);
      await runDailyBirthdayJob();
	  console.log(`✅ Check completed for ${serverTIME_str}`);
    }
  })();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction, { client, DATA_FILE });
  } catch (err) {
    console.error('Command execution error:', err);
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ content: 'Det oppsto en feil ved kjøring av kommandoen.' });
      } else {
        await interaction.reply({ content: 'Det oppsto en feil ved kjøring av kommandoen.', flags: MessageFlags.Ephemeral });
      }
    } catch (err2) {
      console.error('Failed to reply to interaction error:', err2);
    }
  }
});

async function runDailyBirthdayJob() {
  // loads data, iterates through whitelisted servers, and sends messages
  try {
    const data = loadData(DATA_FILE);

    const todayStr = dayjs().format('YYYY-MM-DD');

    const whitelisted = data.whitelistedServers || [];
    for (const serverId of whitelisted) {
      try {
        // skip if already sent for this server today
        if (data.lastSent && data.lastSent[serverId] === todayStr) {
          continue;
        }

        const serverSettings = (data.servers && data.servers[serverId]) || {};
        const channelId = serverSettings.channelId;
        const roleId = serverSettings.roleId;

        if (!channelId) {
          console.log(`No channel set for server ${serverId}, skipping.`);
          continue;
        }

        const guild = await client.guilds.fetch(serverId).catch(() => null);
        if (!guild) {
          console.log(`Bot is not in guild ${serverId}, skipping.`);
          continue;
        }

        // find birthdays in that server matching today's month/day
        const bdays = (data.birthdays || []).filter(b => b.ServerId === serverId);
        const todayMatches = bdays.filter(b => {
          // compare month-day to today
          try {
            const m = b.Dato.split('-'); // YYYY-MM-DD
            return m[1] === dayjs().format('MM') && m[2] === dayjs().format('DD');
          } catch {
            return false;
          }
        });

        if (todayMatches.length === 0) {
          // mark as sent anyway to avoid repeated checks? We'll still set lastSent so we don't run again today.
          data.lastSent = data.lastSent || {};
          data.lastSent[serverId] = todayStr;
          saveData(DATA_FILE, data);
          continue;
        }

        // build message(s) — single message for all today's birthdays in that server
        const lines = [];
        for (const b of todayMatches) {
          // check member exists in guild
          try {
            const member = await guild.members.fetch(b.Userid).catch(() => null);
            if (!member) {
              console.log(`User ${b.Userid} not found in guild ${serverId}. Skipping.`);
              continue;
            }
            // compute age
            const birth = dayjs(b.Dato, 'YYYY-MM-DD');
            const age = dayjs().diff(birth, 'year');
            lines.push(`🎂 <@${b.Userid}> fyller ${age} år i dag!`);
          } catch (err) {
            console.error('Error fetching member or computing age:', err);
            continue;
          }
        }

        if (lines.length === 0) {
          data.lastSent = data.lastSent || {};
          data.lastSent[serverId] = todayStr;
          saveData(DATA_FILE, data);
          continue;
        }

        // generate GPT-style body
        const { generateBirthdayMessage } = require('./utils/generateMessage');
        const title = lines.length === 1 ? 'Gratulerer med dagen!' : 'Gratulerer med dagen alle sammen!';
        const body = await generateBirthdayMessage(lines.map(l => l.replace(/^🎂 /,''))).catch(err => {
          console.error('generateBirthdayMessage failed, falling back:', err);
          return lines.join('\n') + '\nHa en flott dag!';
        });

        // final message with optional role ping
        let finalMessage = `**${title}**${body}`;
        if (roleId) finalMessage = `@everyone ${finalMessage}`;

        // send to channel
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased?.()) {
          console.log(`Cannot fetch text channel ${channelId} in server ${serverId}.`);
          continue;
        }

        try {
          await channel.send({ content: finalMessage });
          console.log(`Sent birthday message in guild ${serverId} to channel ${channelId}`);
          data.lastSent = data.lastSent || {};
          data.lastSent[serverId] = todayStr;
          saveData(DATA_FILE, data);
        } catch (err) {
          console.error('Failed to send birthday message:', err);
        }

      } catch (err) {
        console.error('Error processing server in daily job:', err);
      }
    } // end for
  } catch (err) {
    console.error('Daily job failed:', err);
  }
}

client.login(process.env.DISCORD_TOKEN);
