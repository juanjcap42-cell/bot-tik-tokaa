const { app, BrowserWindow, ipcMain } = require('electron');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');

let win;
let vozActivada = false;
let contadorLikes = {};
let ultimoMensajeUsuario = {}; // Registro para Anti-Spam

function createWindow() {
    win = new BrowserWindow({
        width: 850,
        height: 700,
        resizable: false, 
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile('index.html');
    win.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

const palabrasProhibidas = [
    "hijo de perra", "hijo de puta", "hija de puta", "vete a la mierda", "andate a la mierda",
    "hijo de tu puta madre", "chupa la", "tu mama es",
    "mierda", "puto", "puta", "pendejo", "pendeja", "marico", "marica", "malparido", 
    "gonorrea", "carajo", "chinga", "cabron", "cabrona", "culero", "culera", "hdp", 
    "mamaguevo", "mgb", "mmg", "guevon", "weon", "wn", "chucha", "concha", "coño"
];

function esMensajeValidoEspanol(texto) {
    let textoMinuscula = texto.toLowerCase().trim();
    for (let palabra of palabrasProhibidas) {
        if (textoMinuscula.includes(palabra)) return false; 
    }
    const soloEspanolRegExp = /^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ\s.,¡!¿?()\-+*=]+$/;
    if (!soloEspanolRegExp.test(texto)) return false; 
    const letrasRepetidasRegExp = /([a-zA-Z])\1{4,}/;
    if (letrasRepetidasRegExp.test(textoMinuscula)) return false;
    return true; 
}

function limpiarTexto(texto) {
    return texto.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
                .replace(/[^\w\sáéíóúÁÉÍÓÚñÑüÜ.,¡!¿?]/gu, '')
                .trim();
}

async function obtenerVozFluida(texto) {
    try {
        const textoCodificado = encodeURIComponent(texto);
        const urlGoogle = `https://translate.google.com/translate_tts?ie=UTF-8&q=${textoCodificado}&tl=es-419&client=tw-ob`;
        const respuesta = await axios.get(urlGoogle, { responseType: 'arraybuffer' });
        if (respuesta.data) {
            return Buffer.from(respuesta.data, 'binary').toString('base64');
        }
    } catch (error) {
        console.log("Aviso: Error con voz de Google, usando respaldo...");
    }
    return null; 
}

ipcMain.on('conectar-tiktok', (event, username) => {
    vozActivada = false; 
    contadorLikes = {}; 
    ultimoMensajeUsuario = {}; // Reset al conectar

    let tiktokConnect = new WebcastPushConnection(username, {
        processInitialData: true,
        requestOptions: {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0'
            }
        }
    });

    tiktokConnect.connect().then(state => {
        win.webContents.send('status-conectado');
        win.webContents.send('nuevo-log', `Conectado al Live de ${username}`);

        setTimeout(() => {
            vozActivada = true;
            win.webContents.send('nuevo-log', `[Bot de Voz y Pelotas Rebotadoras Activo]`);
        }, 3000);

    }).catch(err => {
        console.error(err);
        win.webContents.send('nuevo-log', `Error al conectar`);
    });

    tiktokConnect.on('chat', async (data) => {
        let comentario = data.comment;
        let usuarioId = data.userId;
        win.webContents.send('nuevo-log', `${data.uniqueId}: ${comentario}`);
        
        if (!vozActivada) return;

        // --- LÓGICA ANTI-SPAM ---
        if (ultimoMensajeUsuario[usuarioId] === comentario) return;
        ultimoMensajeUsuario[usuarioId] = comentario;
        // -----------------------

        if (esMensajeValidoEspanol(comentario)) {
            let usuarioLimpiado = limpiarTexto(data.nickname);
            let comentarioLimpiado = limpiarTexto(comentario);
            
            let mensajeParaHablar = `${usuarioLimpiado} dice: ${comentarioLimpiado}`;
            const audioBase64 = await obtenerVozFluida(mensajeParaHablar);
            win.webContents.send('mandar-a-decir', { texto: mensajeParaHablar, audio: audioBase64 });
        }
    });

    tiktokConnect.on('like', (data) => {
        if (!vozActivada) return;

        const idUnico = data.userId; 
        const apodo = data.nickname; 
        const foto = data.profilePictureUrl;
        
        const cantidadAñadir = parseInt(data.likeCount) || 1;

        if (!contadorLikes[idUnico]) {
            contadorLikes[idUnico] = { nombre: idUnico, foto: foto, clicks: 0, apodo: apodo };
        }
        
        contadorLikes[idUnico].clicks += cantidadAñadir;
        contadorLikes[idUnico].apodo = apodo;

        let TOP3 = Object.values(contadorLikes)
            .sort((a, b) => b.clicks - a.clicks)
            .slice(0, 3);

        win.webContents.send('actualizar-esferas-rebotadoras', TOP3);
    });
});