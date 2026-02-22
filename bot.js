require('dotenv').config(); 
const { Telegraf } = require('telegraf');
const { MongoClient } = require('mongodb');
const express = require('express');

// 1. CONFIGURATION
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const APP_URL = process.env.APP_URL;
const PORT = process.env.PORT || 3000;

const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];

const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI, { connectTimeoutMS: 30000 });
const app = express();

let usersCollection;
let broadcastLogsCollection;
let settingsCollection;
let isBroadcasting = false; // NEW: Lock variable

const isAdmin = (id) => ADMIN_IDS.includes(id);

// 2. KEEP RENDER ALIVE
app.get('/', (req, res) => res.send('Afro Bot is Online!'));
app.listen(PORT, () => console.log(`✅ Web Server: Port ${PORT} opened.`));

// 3. CONNECT TO DATABASE
async function connectDB() {
    try {
        await client.connect();
        const database = client.db('afro_leaks_db');
        usersCollection = database.collection('users');
        broadcastLogsCollection = database.collection('broadcast_logs');
        settingsCollection = database.collection('settings');
        console.log("✅ Database: Connected.");
    } catch (e) {
        console.error("❌ Database Error:", e);
        setTimeout(connectDB, 5000); 
    }
}

// 4. BOT START
bot.start(async (ctx) => {
    const userId = ctx.chat.id;
    try {
        await usersCollection.updateOne(
            { chat_id: userId },
            { $set: { username: ctx.from.username || "anonymous", first_name: ctx.from.first_name || "User", last_active: new Date() } },
            { upsert: true }
        );
        const welcomeData = await settingsCollection.findOne({ key: "welcome_config" });
        const msgText = welcomeData?.text || `Welcome ${ctx.from.first_name} to Xclusive Premium! 🔞`;
        const btnText = welcomeData?.button || "WATCH LEAKS 🔞";
        await ctx.reply(msgText, { reply_markup: { inline_keyboard: [[{ text: btnText, web_app: { url: APP_URL } }]] } });
    } catch (err) { console.error(`❌ Start Error: ${err.message}`); }
});

// 5. ADMIN PANEL
bot.command('admin', (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Unauthorized.");
    ctx.reply("🛠 **Admin Panel**", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📊 View Stats", callback_data: "admin_stats" }],
                [{ text: "👁 Preview Info", callback_data: "admin_help" }],
                [{ text: "🔄 Refresh System", callback_data: "admin_refresh" }]
            ]
        }
    });
});

bot.action('admin_stats', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    try {
        const totalUsers = await usersCollection.countDocuments();
        const activeUsers = await usersCollection.countDocuments({ last_active: { $gte: new Date(Date.now() - 86400000) } });
        await ctx.answerCbQuery();
        await ctx.reply(`📊 **Stats**\n\nTotal: ${totalUsers}\nActive (24h): ${activeUsers}`);
    } catch (e) { console.error("❌ Stats Error:", e); }
});

bot.action('admin_help', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    await ctx.reply("📢 **Guide:**\n/setwelcome [Text] | [Btn]\n/preview [URL] | [Btn]\n/send [URL] | [Btn]");
});

bot.action('admin_refresh', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    ctx.reply(isBroadcasting ? "⚠️ System Busy: Broadcast in progress." : "✅ System Idle: Connection stable.");
});

bot.command('setwelcome', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Unauthorized.");
    const input = ctx.message.text.split(' ').slice(1).join(' ');
    if (!input || !input.includes('|')) return ctx.reply("Usage: Text | Button");
    const [text, button] = input.split('|').map(s => s.trim());
    await settingsCollection.updateOne({ key: "welcome_config" }, { $set: { text, button } }, { upsert: true });
    ctx.reply(`✅ Welcome updated!`);
});

bot.command('preview', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Unauthorized.");
    const fullInput = ctx.message.text.split(' ').slice(1).join(' ');
    if (!fullInput) return ctx.reply("Usage: [Msg/URL] | [Button]");
    const [content, btnLabel] = fullInput.split('|').map(s => s.trim());
    const extra = btnLabel ? { reply_markup: { inline_keyboard: [[{ text: btnLabel, web_app: { url: APP_URL } }]] } } : {};
    const isUrl = content.split(' ')[0].startsWith('http');
    try {
        if (isUrl) {
            const media = content.split(' ')[0];
            const cap = content.split(' ').slice(1).join(' ');
            if (media.match(/\.(mp4|mov|avi)$/i)) await ctx.replyWithVideo(media, { caption: cap, ...extra });
            else await ctx.replyWithPhoto(media, { caption: cap, ...extra });
        } else { await ctx.reply(content, extra); }
    } catch (e) { ctx.reply(`❌ Error: ${e.message}`); }
});

// 6. PROTECTED BROADCAST
bot.command('send', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Unauthorized.");
    
    // Check if a broadcast is already running
    if (isBroadcasting) {
        return ctx.reply("⚠️ Error: A broadcast is already in progress. Please wait for it to finish.");
    }

    const fullInput = ctx.message.text.split(' ').slice(1).join(' ');
    if (!fullInput) return ctx.reply("Usage: [Msg/URL] | [Button]");

    const [content, btnLabel] = fullInput.split('|').map(s => s.trim());
    const extra = btnLabel ? { reply_markup: { inline_keyboard: [[{ text: btnLabel, web_app: { url: APP_URL } }]] } } : {};
    const isUrl = content.split(' ')[0].startsWith('http');
    const media = isUrl ? content.split(' ')[0] : null;
    const cap = isUrl ? content.split(' ').slice(1).join(' ') : content;

    const allUsers = await usersCollection.find({}).toArray();
    
    // LOCK SYSTEM
    isBroadcasting = true;
    console.log(`🚀 Broadcast Started: Targeting ${allUsers.length} users.`);
    ctx.reply(`🚀 Broadcasting to ${allUsers.length} users. Do not send another command until finished.`);

    let count = 0;
    for (const user of allUsers) {
        try {
            let sent;
            if (isUrl) {
                if (media.match(/\.(mp4|mov|avi)$/i)) sent = await bot.telegram.sendVideo(user.chat_id, media, { caption: cap, ...extra });
                else sent = await bot.telegram.sendPhoto(user.chat_id, media, { caption: cap, ...extra });
            } else {
                sent = await bot.telegram.sendMessage(user.chat_id, cap, extra);
            }
            await broadcastLogsCollection.insertOne({ broadcast_id: "last", chat_id: user.chat_id, message_id: sent.message_id, sent_at: new Date() });
            count++;
            if (count % 20 === 0) console.log(`📡 Progress: ${count}/${allUsers.length}`);
            await new Promise(r => setTimeout(r, 150)); // Slightly slower for database safety
        } catch (err) {
            if (err.response?.error_code === 403) await usersCollection.deleteOne({ chat_id: user.chat_id });
        }
    }
    
    // UNLOCK SYSTEM
    isBroadcasting = false;
    console.log(`✅ Broadcast Finished: Sent to ${count}.`);
    ctx.reply(`✅ Finished. Sent to ${count} users.`);
});

bot.command('deleteall', async (ctx) => {
    if (!isAdmin(ctx.from.id)) return ctx.reply("Unauthorized.");
    if (isBroadcasting) return ctx.reply("⚠️ Cannot delete while broadcasting.");
    const logs = await broadcastLogsCollection.find({ broadcast_id: "last" }).toArray();
    for (const log of logs) { try { await bot.telegram.deleteMessage(log.chat_id, log.message_id); } catch (e) {} }
    await broadcastLogsCollection.deleteMany({ broadcast_id: "last" });
    ctx.reply("✨ Wiped.");
});

// 8. STARTUP
connectDB().then(() => {
    bot.launch({ dropPendingUpdates: true });
    console.log("🚀 Bot Live with Broadcast Locking.");
});

process.on('unhandledRejection', (r) => {
    console.error('🔴 Rejection:', r);
    isBroadcasting = false; // Reset lock on crash
});
process.on('uncaughtException', (e) => {
    console.error('🔴 Exception:', e);
    isBroadcasting = false;
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));