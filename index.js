const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const INTERVALO_MINUTOS = 5;
let ultimaSalida = null;
let despachoActivo = true;
let listaTurnos = []; // Almacena los turnos activos de la jornada

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_bot');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Desktop', 'Chrome', '100.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\nEscanea este código QR con tu WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Desconectado. Reconectando...');
            if (shouldReconnect) iniciarBot();
        }
        if (connection === 'open') {
            console.log('\n¡Bot despachador interactivo conectado y listo!\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        
        const jid = msg.key.remoteJid;
        if (!jid || !jid.endsWith('@g.us')) return; // Solo grupos

        const textoOriginal = (
            msg.message.conversation || 
            msg.message.extendedTextMessage?.text || 
            msg.message.imageMessage?.caption || ''
        ).trim();

        const texto = textoOriginal.toLowerCase();

        if (
            texto.includes('ticket de despacho') || 
            texto.includes('central de despachos') || 
            texto.includes('lista de turnos') ||
            texto.startsWith('⚠️ usa:')
        ) return;

        console.log(`[Mensaje en grupo]: ${texto}`);

        // Verificación de administrador
        let esAdmin = msg.key.fromMe;
        if (!esAdmin) {
            try {
                const metadata = await sock.groupMetadata(jid);
                const remitente = msg.key.participant || msg.participant;
                const participante = metadata.participants.find(p => p.id === remitente);
                if (participante && (participante.admin === 'admin' || participante.admin === 'superadmin')) {
                    esAdmin = true;
                }
            } catch (e) {
                esAdmin = false;
            }
        }

        // Comandos de Administrador
        if (esAdmin) {
            if (texto === '!abrir') {
                despachoActivo = true;
                await sock.sendMessage(jid, { text: '🟢 *¡Central de Despachos abierta! Ya pueden pedir turnos.*' }, { quoted: msg });
                return;
            }
            if (texto === '!cerrar') {
                despachoActivo = false;
                await sock.sendMessage(jid, { text: '🔴 *¡Central de Despachos cerrada temporalmente!*' }, { quoted: msg });
                return;
            }
            if (texto === '!limpiar') {
                listaTurnos = [];
                ultimaSalida = null;
                await sock.sendMessage(jid, { text: '🧹 *¡Lista de turnos reseteada y limpia para una nueva jornada!*' }, { quoted: msg });
                return;
            }
        }

        // Comando para ver la lista de turnos (para todos)
        if (texto === '!lista' || texto === '!turnos') {
            if (listaTurnos.length === 0) {
                await sock.sendMessage(jid, { text: '📋 *No hay unidades formadas en la lista actual.*' }, { quoted: msg });
                return;
            }

            let resumen = `📋 *UNIDADES EN ESPERA / SALIDAS*\n━━━━━━━━━━━━━━━━━━━━\n`;
            listaTurnos.forEach((t, index) => {
                resumen += `${index + 1}. Disco #${t.disco} (${t.ruta}) ➔ *${t.hora}*\n`;
            });
            resumen += `━━━━━━━━━━━━━━━━━━━━`;
            await sock.sendMessage(jid, { text: resumen }, { quoted: msg });
            return;
        }

        if (!despachoActivo) {
            if (texto.startsWith('!turno')) {
                await sock.sendMessage(jid, { text: '⚠️ *La central está cerrada. No se admiten turnos en este momento.*' }, { quoted: msg });
            }
            return;
        }

        // Solicitud de Turno
        if (texto.startsWith('!turno')) {
            const partes = textoOriginal.split(' ');
            if (partes.length < 2) {
                await sock.sendMessage(jid, { text: '⚠️ Usa correctamente: *!turno [Disco] [Ruta]*\nEj: _!turno 12 Quitumbe_' }, { quoted: msg });
                return;
            }

            const disco = partes[1];
            const ruta = partes.slice(2).join(' ') || 'Ruta General';
            const ahora = new Date();

            let horaAsignada;
            if (!ultimaSalida || ultimaSalida < ahora) {
                horaAsignada = new Date(ahora.getTime() + 2 * 60000);
            } else {
                horaAsignada = new Date(ultimaSalida.getTime() + INTERVALO_MINUTOS * 60000);
            }
            ultimaSalida = horaAsignada;

            const horas = String(horaAsignada.getHours()).padStart(2, '0');
            const minutos = String(horaAsignada.getMinutes()).padStart(2, '0');
            const horaFormateada = `${horas}:${minutos}`;

            // Guardar en la memoria temporal del bot
            listaTurnos.push({ disco, ruta, hora: horaFormateada });

            const ticket = 
                `🚌 *TICKET DE DESPACHO*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🔢 *Disco:* #${disco}\n` +
                `🛣️ *Ruta:* ${ruta}\n` +
                `🕒 *Hora de Salida:* *${horaFormateada}*\n` +
                `⏱️ *Frecuencia:* Cada ${INTERVALO_MINUTOS} min\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `✅ _Buen viaje, compañero._`;

            await sock.sendMessage(jid, { text: ticket }, { quoted: msg });
        }
    });
}

iniciarBot();