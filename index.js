require('dotenv').config()
const { Client, GatewayIntentBits, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const axios = require('axios')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

const GUILD_ID = process.env.DISCORD_GUILD_ID
const WEBSITE_URL = process.env.WEBSITE_URL
const BOT_API_SECRET = process.env.BOT_API_SECRET
const ADMIN_IDS = process.env.ADMIN_IDS.split(',')
const CUSTOMER_ROLE_ID = process.env.CUSTOMER_ROLE_ID

// Cache pour les vérifications de membres
const memberCheckCache = new Map()

let ticketCategory = null
const activeTickets = new Map() // orderId -> channelId

client.once('clientReady', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`)
  console.log(`📋 Guild ID: ${GUILD_ID}`)
  console.log(`🔑 Bot API Secret configuré: ${BOT_API_SECRET ? 'Oui' : 'Non'}`)
  console.log(`🌐 Website URL: ${WEBSITE_URL}`)
  
  // Find or create ticket category
  const guild = client.guilds.cache.get(GUILD_ID)
  
  if (!guild) {
    console.error('❌ ERREUR: Le bot n\'est pas sur le serveur Discord spécifié!')
    console.error(`   Vérifiez que le GUILD_ID (${GUILD_ID}) est correct`)
    console.error(`   Et que le bot a bien été invité sur ce serveur`)
  } else {
    console.log(`✅ Serveur trouvé: ${guild.name}`)
    console.log(`👥 Membres dans le cache: ${guild.memberCount}`)
  }
  if (guild) {
    ticketCategory = guild.channels.cache.find(
      c => c.name === 'TICKETS' && c.type === ChannelType.GuildCategory
    )
    
    if (!ticketCategory) {
      ticketCategory = await guild.channels.create({
        name: 'TICKETS',
        type: ChannelType.GuildCategory,
      })
      console.log('✅ Catégorie TICKETS créée')
    }
  }

  // Start polling for new tickets
  setInterval(pollTickets, 5000)
  setInterval(pollMessages, 5000)
  setInterval(pollQuoteTickets, 5000)
  setInterval(pollQuoteNotifications, 5000)
  setInterval(pollDMs, 5000)
  setInterval(pollAdminNotifications, 5000)
  setInterval(pollRoleAssignments, 5000)
})

async function pollTickets() {
  try {
    const response = await axios.get(`${WEBSITE_URL}/api/bot/create-ticket`, {
      headers: {
        'Authorization': `Bearer ${BOT_API_SECRET}`,
      },
    })

    const { tickets } = response.data

    for (const ticket of tickets) {
      await createTicket(ticket)
    }
  } catch (error) {
    if (error.response?.status !== 401) {
      console.error('Erreur lors de la récupération des tickets:', error.message)
    }
  }
}

async function createTicket(ticket) {
  try {
    const guild = client.guilds.cache.get(GUILD_ID)
    if (!guild) return

    const { orderId, userId, username } = ticket

    // Check if ticket already exists
    if (activeTickets.has(orderId)) {
      return
    }

    // Create ticket channel
    const channel = await guild.channels.create({
      name: `ticket-${username}-${orderId.slice(0, 8)}`,
      type: ChannelType.GuildText,
      parent: ticketCategory?.id,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: userId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        ...ADMIN_IDS.map(adminId => ({
          id: adminId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        })),
      ],
    })

    activeTickets.set(orderId, channel.id)

    const embed = new EmbedBuilder()
      .setColor('#ff0040')
      .setTitle('🎫 Nouveau Ticket')
      .setDescription(`Commande: \`${orderId}\`\nClient: <@${userId}>`)
      .addFields(
        { name: '📋 Statut', value: 'En attente', inline: true },
        { name: '📊 Progression', value: '0%', inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'EZBshop' })

    await channel.send({ embeds: [embed] })
    await channel.send(`<@${userId}> Bienvenue ! Notre équipe va prendre en charge votre commande. ${ADMIN_IDS.map(id => `<@${id}>`).join(' ')}`)

    console.log(`✅ Ticket créé: ${channel.name}`)
  } catch (error) {
    console.error('Erreur lors de la création du ticket:', error)
  }
}

async function pollMessages() {
  try {
    const response = await axios.get(`${WEBSITE_URL}/api/bot/send-message`, {
      headers: {
        'Authorization': `Bearer ${BOT_API_SECRET}`,
      },
    })

    const { messages } = response.data

    for (const msg of messages) {
      await sendMessage(msg)
    }
  } catch (error) {
    if (error.response?.status !== 401) {
      console.error('Erreur lors de la récupération des messages:', error.message)
    }
  }
}

async function sendMessage(msg) {
  try {
    const channel = client.channels.cache.get(msg.channelId)
    if (channel) {
      await channel.send(msg.message)
    }
  } catch (error) {
    console.error('Erreur lors de l\'envoi du message:', error)
  }
}

// Check if user is on server
client.on('guildMemberAdd', async (member) => {
  console.log(`✅ Nouveau membre: ${member.user.tag}`)
})

client.on('guildMemberRemove', async (member) => {
  console.log(`❌ Membre parti: ${member.user.tag}`)
})

// Handle messages in ticket channels
client.on('messageCreate', async (message) => {
  if (message.author.bot) return
  if (!message.channel.name?.startsWith('ticket-')) return

  // Find the order ID from active tickets
  let orderId = null
  for (const [oid, channelId] of activeTickets.entries()) {
    if (channelId === message.channel.id) {
      orderId = oid
      break
    }
  }

  if (!orderId) return

  // Sync message to website (you can implement this endpoint)
  console.log(`📨 Message dans ticket ${orderId}: ${message.content}`)
})

// Handle button interactions
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return

  const [action, orderId] = interaction.customId.split('_')

  if (action === 'createquote') {
    // Admin wants to create a quote
    await interaction.reply({
      content: `Pour créer un devis pour la commande \`${orderId}\`, utilisez la commande:\n\`\`\`\n/devis ${orderId} [nom_produit] [prix] [description]\n\`\`\``,
      ephemeral: true
    })
  } else if (action === 'acceptquote') {
    // User accepts the quote
    await interaction.deferReply({ ephemeral: true })
    
    try {
      const response = await axios.post(
        `${WEBSITE_URL}/api/orders/${orderId}/accept-quote`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${BOT_API_SECRET}`,
          },
        }
      )

      await interaction.editReply({
        content: `✅ Redirection vers le paiement...\n${response.data.paymentUrl}`,
        ephemeral: true
      })

      // Notify admins
      await interaction.channel.send(`<@${interaction.user.id}> a accepté le devis ! ${ADMIN_IDS.map(id => `<@${id}>`).join(' ')}`)
    } catch (error) {
      await interaction.editReply({
        content: `❌ Erreur: ${error.response?.data?.error || error.message}`,
        ephemeral: true
      })
    }
  }
})

async function pollQuoteTickets() {
  try {
    const response = await axios.get(`${WEBSITE_URL}/api/bot/create-quote-ticket`, {
      headers: {
        'Authorization': `Bearer ${BOT_API_SECRET}`,
      },
    })

    const { tickets } = response.data

    for (const ticket of tickets) {
      await createQuoteTicket(ticket)
    }
  } catch (error) {
    if (error.response?.status !== 401 && error.response?.status !== 404) {
      console.error('Erreur lors de la récupération des tickets de devis:', error.message)
    }
  }
}

async function createQuoteTicket(ticket) {
  try {
    const guild = client.guilds.cache.get(GUILD_ID)
    if (!guild) return

    const { orderId, discordId, username, serviceType, description } = ticket

    // Check if ticket already exists
    if (activeTickets.has(orderId)) {
      return
    }

    // Create ticket channel
    const channel = await guild.channels.create({
      name: `devis-${username}-${orderId.slice(0, 8)}`,
      type: ChannelType.GuildText,
      parent: ticketCategory?.id,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: discordId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        ...ADMIN_IDS.map(adminId => ({
          id: adminId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        })),
      ],
    })

    activeTickets.set(orderId, channel.id)

    const embed = new EmbedBuilder()
      .setColor('#cc0033')
      .setTitle('💼 Demande de Devis')
      .setDescription(`**Service:** ${serviceType}\n**Description:** ${description}\n\n**Client:** <@${discordId}>`)
      .addFields(
        { name: '📋 Statut', value: 'En attente de devis', inline: true },
        { name: '🆔 Commande', value: `\`${orderId}\``, inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'EZBshop - Système de devis' })

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`createquote_${orderId}`)
          .setLabel('Créer un devis')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('💰')
      )

    await channel.send({ embeds: [embed], components: [row] })
    await channel.send(`<@${discordId}> Bienvenue ! Notre équipe va étudier votre demande et vous proposer un devis personnalisé. ${ADMIN_IDS.map(id => `<@${id}>`).join(' ')}`)

    console.log(`✅ Ticket de devis créé: ${channel.name}`)

    // Notify website that ticket was created
    await axios.post(
      `${WEBSITE_URL}/api/bot/ticket-created`,
      { orderId, channelId: channel.id },
      {
        headers: {
          'Authorization': `Bearer ${BOT_API_SECRET}`,
        },
      }
    )
  } catch (error) {
    console.error('Erreur lors de la création du ticket de devis:', error)
  }
}

async function pollQuoteNotifications() {
  try {
    const response = await axios.get(`${WEBSITE_URL}/api/bot/send-quote`, {
      headers: {
        'Authorization': `Bearer ${BOT_API_SECRET}`,
      },
    })

    const { quotes } = response.data

    for (const quote of quotes) {
      await sendQuoteNotification(quote)
    }
  } catch (error) {
    if (error.response?.status !== 401 && error.response?.status !== 404) {
      console.error('Erreur lors de la récupération des notifications de devis:', error.message)
    }
  }
}

async function sendQuoteNotification(quote) {
  try {
    const { channelId, userId, productName, price, description, orderId } = quote
    const channel = client.channels.cache.get(channelId)
    
    if (!channel) return

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('✅ Votre devis est prêt !')
      .setDescription(`**Produit:** ${productName}\n**Prix:** ${price}€\n\n**Description:**\n${description}`)
      .addFields(
        { name: '💳 Paiement', value: 'Cliquez sur le bouton ci-dessous pour procéder au paiement', inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'EZBshop - Devis personnalisé' })

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`acceptquote_${orderId}`)
          .setLabel(`Acheter - ${price}€`)
          .setStyle(ButtonStyle.Success)
          .setEmoji('💳')
      )

    await channel.send({ content: `<@${userId}>`, embeds: [embed], components: [row] })
    console.log(`✅ Notification de devis envoyée pour ${orderId}`)
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification de devis:', error)
  }
}

async function pollDMs() {
  try {
    const response = await axios.get(`${WEBSITE_URL}/api/bot/send-dm`, {
      headers: {
        'Authorization': `Bearer ${BOT_API_SECRET}`,
      },
    })

    const { dms } = response.data

    for (const dm of dms) {
      await sendDM(dm)
    }
  } catch (error) {
    if (error.response?.status !== 401 && error.response?.status !== 404) {
      console.error('Erreur lors de la récupération des MPs:', error.message)
    }
  }
}

async function sendDM(dm) {
  try {
    const { userId, message } = dm
    const user = await client.users.fetch(userId)
    
    if (user) {
      await user.send(message)
      console.log(`✅ MP envoyé à ${user.tag}`)
    }
  } catch (error) {
    console.error('Erreur lors de l\'envoi du MP:', error)
  }
}

async function pollAdminNotifications() {
  try {
    const response = await axios.get(`${WEBSITE_URL}/api/bot/notify-admins`, {
      headers: {
        'Authorization': `Bearer ${BOT_API_SECRET}`,
      },
    })

    const { notifications } = response.data

    for (const notif of notifications) {
      await sendAdminNotification(notif)
    }
  } catch (error) {
    if (error.response?.status !== 401 && error.response?.status !== 404) {
      console.error('Erreur lors de la récupération des notifications admin:', error.message)
    }
  }
}

async function sendAdminNotification(notif) {
  try {
    const { message } = notif
    const guild = client.guilds.cache.get(GUILD_ID)
    
    if (!guild) return

    // Envoyer un MP à chaque admin
    for (const adminId of ADMIN_IDS) {
      try {
        const user = await client.users.fetch(adminId)
        if (user) {
          await user.send(message)
          console.log(`✅ Notification envoyée à l'admin ${user.tag}`)
        }
      } catch (error) {
        console.error(`Erreur lors de l'envoi à l'admin ${adminId}:`, error.message)
      }
    }
  } catch (error) {
    console.error('Erreur lors de l\'envoi de la notification admin:', error)
  }
}

async function pollRoleAssignments() {
  try {
    const response = await axios.get(`${WEBSITE_URL}/api/bot/assign-role`, {
      headers: {
        'Authorization': `Bearer ${BOT_API_SECRET}`,
      },
    })

    const { assignments } = response.data

    for (const assignment of assignments) {
      await assignCustomerRole(assignment)
    }
  } catch (error) {
    if (error.response?.status !== 401 && error.response?.status !== 404) {
      console.error('Erreur lors de la récupération des rôles à assigner:', error.message)
    }
  }
}

async function assignCustomerRole(assignment) {
  try {
    const { userId } = assignment
    const guild = client.guilds.cache.get(GUILD_ID)
    
    if (!guild) {
      console.error('Serveur Discord non trouvé')
      return
    }

    if (!CUSTOMER_ROLE_ID) {
      console.error('CUSTOMER_ROLE_ID non configuré')
      return
    }

    const member = await guild.members.fetch(userId)
    
    if (!member) {
      console.error(`Membre ${userId} non trouvé`)
      return
    }

    // Vérifier si le membre a déjà le rôle
    if (member.roles.cache.has(CUSTOMER_ROLE_ID)) {
      console.log(`${member.user.tag} a déjà le rôle client`)
      return
    }

    // Assigner le rôle
    await member.roles.add(CUSTOMER_ROLE_ID)
    console.log(`✅ Rôle client assigné à ${member.user.tag}`)
  } catch (error) {
    console.error('Erreur lors de l\'assignation du rôle:', error)
  }
}

// Endpoint pour vérifier si un utilisateur est sur le serveur
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return

  if (interaction.commandName === 'check-member') {
    const discordId = interaction.options.getString('user_id')
    const guild = client.guilds.cache.get(GUILD_ID)
    
    if (!guild) {
      return interaction.reply({ content: 'Serveur non trouvé', ephemeral: true })
    }

    try {
      const member = await guild.members.fetch(discordId)
      memberCheckCache.set(discordId, { isOnServer: true, timestamp: Date.now() })
      return interaction.reply({ content: `✅ L'utilisateur est sur le serveur`, ephemeral: true })
    } catch (error) {
      memberCheckCache.set(discordId, { isOnServer: false, timestamp: Date.now() })
      return interaction.reply({ content: `❌ L'utilisateur n'est pas sur le serveur`, ephemeral: true })
    }
  }
})

// API HTTP pour vérifier les membres (appelé par le site)
const express = require('express')
const app = express()
app.use(express.json())

app.post('/check-member', async (req, res) => {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${BOT_API_SECRET}`) {
    console.log('❌ Authentification échouée')
    return res.status(401).json({ error: 'Non autorisé' })
  }

  const { discordId } = req.body
  console.log(`🔍 Vérification du membre: ${discordId}`)
  
  const guild = client.guilds.cache.get(GUILD_ID)

  if (!guild) {
    console.log('❌ Serveur Discord non trouvé')
    return res.json({ isOnServer: false })
  }

  try {
    const member = await guild.members.fetch(discordId)
    console.log(`✅ Membre trouvé: ${member.user.tag}`)
    memberCheckCache.set(discordId, { isOnServer: true, timestamp: Date.now() })
    res.json({ isOnServer: true })
  } catch (error) {
    console.log(`❌ Membre non trouvé: ${discordId}`)
    memberCheckCache.set(discordId, { isOnServer: false, timestamp: Date.now() })
    res.json({ isOnServer: false })
  }
})

const PORT = process.env.PORT || process.env.BOT_PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🤖 Bot API listening on port ${PORT}`)
})

client.login(process.env.DISCORD_BOT_TOKEN)
