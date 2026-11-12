const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

async function connectToWhatsApp() {
    // Configura la persistencia de la sesión en la carpeta 'sesion_bot'
    const { state, saveCreds } = await useMultiFileAuthState('sesion_bot');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }) // Silencia logs innecesarios para mantener limpia la consola
    });

    // Manejador de eventos de conexión (QR, reconexiones, éxito)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Escanea el siguiente código QR compacto:');
            // Muestra el QR en formato pequeño para que no se estire en las consolas de la nube
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada debido a:', lastDisconnect?.error, ', reconectando:', shouldReconnect);
            
            // Si no se cerró sesión explícitamente, vuelve a conectar de manera automática
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('¡Bot conectado exitosamente y listo para operar 24/7!');
        }
    });

    // Guardar credenciales de sesión cada vez que se actualicen
    sock.ev.on('creds.update', saveCreds);

    // Escucha de mensajes entrantes (aquí van tus comandos !turno, !lista, etc.)
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const messageContent = m.message.conversation || m.message.extendedTextMessage?.text;
        const sender = m.key.remoteJid;

        if (!messageContent) return;

        console.log(`Mensaje recibido de ${sender}: ${messageContent}`);

        // Ejemplo de respuesta a comandos básicos
        if (messageContent === '!turno') {
            await sock.sendMessage(sender, { text: '¡Comando recibido! Gestionando turno...' });
        }
    });
}

connectToWhatsApp().catch((err) => console.log('Error al iniciar el bot:', err));
