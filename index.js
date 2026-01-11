const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000; // Ajuste para que Railway asigne puerto

// ==========================================
// 1. CONFIGURACIÓN
// ==========================================
const CONFIG = {
    urlLogin: "https://administrativo.icarosoft.com/",
    urlLista: "https://administrativo.icarosoft.com/Listado_clientes_tickets/",
    
    // TUS DATOS REALES
    user: "JOHANC",  
    pass: "@VNjohanc16",

    selUser: '#id_sc_field_login', 
    selPass: '#id_sc_field_pswd',
};

// Variables Globales
let globalBrowser = null;
let mainPage = null;

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// ==========================================
// 2. MOTOR DE LOGIN AUTÓNOMO
// ==========================================
async function iniciarSistema() {
    console.log("🚀 Iniciando Motor V18 (SOLO FINANZAS)...");
    
    // CONFIGURACIÓN LISTA PARA RAILWAY
    globalBrowser = await puppeteer.launch({ 
        headless: "new", 
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--start-maximized'
        ] 
    });

    mainPage = await globalBrowser.newPage();
    
    console.log("🔑 Iniciando sesión...");
    await mainPage.goto(CONFIG.urlLogin, { waitUntil: 'networkidle2' });

    if (await mainPage.$(CONFIG.selUser)) {
        await mainPage.type(CONFIG.selUser, CONFIG.user);
        await mainPage.type(CONFIG.selPass, CONFIG.pass);
        
        await mainPage.evaluate(() => {
            const spans = document.querySelectorAll('span');
            for (const span of spans) {
                if (span.innerText.includes('Login')) {
                    span.click();
                    return;
                }
            }
        });
        
        await mainPage.waitForNavigation({ waitUntil: 'networkidle2' });
        console.log("✅ Login Exitoso.");
    } else {
        console.log("ℹ️ Sesión ya activa.");
    }
}

// ==========================================
// 3. EXTRACTOR (SOLO FACTURAS Y TRANSACCIONES)
// ==========================================
async function escanearFrames(page, tipoObjetivo) {
    for (const frame of page.frames()) {
        try {
            const data = await frame.evaluate((tipo) => {
                const rows = document.querySelectorAll('tr[id^="SC_ancor"]');
                
                // --- B. FACTURAS ---
                if (tipo === 'facturas') {
                    if (rows.length === 0) return null;
                    let facturas = [];
                    const esTablaFactura = document.querySelector('[id^="id_sc_field_nro_factura"]');
                    if (!esTablaFactura && rows.length > 0) return null;

                    rows.forEach(r => {
                        const getNro = r.querySelector('[id^="id_sc_field_nro_factura"]');
                        if (getNro) {
                            const getTxt = (id) => r.querySelector(`[id^="${id}"]`)?.innerText.trim() || "";
                            facturas.push({
                                numero: getTxt('id_sc_field_nro_factura'),
                                fecha: getTxt('id_sc_field_fecha_emision'),
                                estado: getTxt('id_sc_field_status'),
                                monto: getTxt('id_sc_field_total_neto'),
                                saldo: getTxt('id_sc_field_saldo')
                            });
                        }
                    });
                    return facturas.length ? facturas : null;
                }

                // --- C. TRANSACCIONES ---
                if (tipo === 'transacciones') {
                    if (rows.length === 0) return null;
                    let trans = [];
                    const esTablaTrans = document.querySelector('[id^="id_sc_field_referencia"]');
                    if (!esTablaTrans) return null;

                    rows.forEach(r => {
                        const getRef = r.querySelector('[id^="id_sc_field_referencia"]');
                        if (getRef) {
                            const getTxt = (id) => r.querySelector(`[id^="${id}"]`)?.innerText.trim() || "";
                            trans.push({
                                tipo: getTxt('id_sc_field_nombtipo'),
                                forma: getTxt('id_sc_field_nombforma'),
                                referencia: getTxt('id_sc_field_referencia'),
                                monto_bs: getTxt('id_sc_field_monto_bs'),
                                fecha: getTxt('id_sc_field_fecha_transaccion'),
                                status: getTxt('id_sc_field_status')
                            });
                        }
                    });
                    return trans.length ? trans : null;
                }

            }, tipoObjetivo);

            if (data) return data; 
        } catch(e) {}
    }
    return null;
}

async function esperarYExtraer(page, tipo, intentosMax = 5) {
    console.log(`      ⏳ Esperando datos de '${tipo}'...`);
    for (let i = 0; i < intentosMax; i++) {
        const data = await escanearFrames(page, tipo);
        if (data) {
            console.log("      ✅ Datos capturados.");
            return data;
        }
        await esperar(2000); 
    }
    console.log("      ⚠️ Tiempo agotado. No se detectaron datos.");
    return null;
}

// ==========================================
// 4. FLUJO DE BÚSQUEDA (MODIFICADO)
// ==========================================
async function buscarCliente(idBusqueda) {
    if (!globalBrowser) throw new Error("Sistema iniciando...");
    console.log(`🤖 Procesando: ${idBusqueda}`);
    const page = await globalBrowser.newPage();

    try {
        await page.goto(CONFIG.urlLista, { waitUntil: 'networkidle2' });

        // BUSCAR
        const searchIn = '#SC_fast_search_top'; 
        const searchBtn = '#SC_fast_search_submit_top';
        if (await page.$(searchIn)) {
            await page.type(searchIn, idBusqueda);
            await page.click(searchBtn);
            await esperar(5000); 
        }

        // ENTRAR
        const iconEdit = '.fa-user-edit';
        try { await page.waitForSelector(iconEdit, { timeout: 15000 }); } 
        catch(e) { throw new Error("Cliente no encontrado."); }

        const newTargetPromise = globalBrowser.waitForTarget(target => target.opener() === page.target());
        await page.click(iconEdit);
        const tab = await (await newTargetPromise).page();
        await tab.bringToFront();
        await esperar(4000); 

        // --- SALTAMOS PERFIL ---
        
        // 1. FACTURAS (Directo)
        console.log("   ⬇️ Facturas...");
        try { await tab.click('#cel3 a'); await esperar(3000); } catch(e){} 
        let facturas = await esperarYExtraer(tab, 'facturas', 5);

        // 2. TRANSACCIONES
        console.log("   ⬇️ Transacciones...");
        let clickTrans = false;
        for (const frame of tab.frames()) {
            try {
                const clickeado = await frame.evaluate(() => {
                    const els = Array.from(document.querySelectorAll('a, span, div'));
                    const target = els.find(el => el.innerText.toUpperCase().includes("TRANSACCIONES"));
                    if (target) {
                        target.click();
                        return true;
                    }
                    return false;
                });
                if (clickeado) { clickTrans = true; break; }
            } catch(e) {}
        }

        if (clickTrans) {
            console.log("      (Clic realizado. ESPERANDO 18 SEGUNDOS...)");
            await esperar(18000); 
            var transacciones = await esperarYExtraer(tab, 'transacciones', 5);
        } else {
            console.log("      ⚠️ No encontré botón 'Transacciones'.");
            transacciones = [];
        }

        await tab.close();
        await page.close();

        return {
            id: idBusqueda,
            facturas: facturas || [],
            transacciones: transacciones || []
        };

    } catch (error) {
        if(page && !page.isClosed()) await page.close();
        throw error;
    }
}

// ==========================================
// 5. SERVIDOR
// ==========================================
app.get('/buscar', async (req, res) => {
    try {
        const datos = await buscarCliente(req.query.id);
        res.json({ success: true, data: datos });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, async () => {
    console.log(`\n🚀 SERVIDOR V18 (SOLO FINANZAS) LISTO: http://localhost:${PORT}`);
    
    // 1. Arranque inicial
    await iniciarSistema();

    // 2. CICLO DE REINICIO (CADA 10 MINUTOS)
    setInterval(async () => {
        console.log("\n♻️ MANTENIMIENTO: Reiniciando navegador (Ciclo 10 min)...");
        
        // A. Cerrar Navegador
        if (globalBrowser) {
            try { await globalBrowser.close(); } catch(e) { console.log("   ⚠️ Error cerrando (ignorable)."); }
            globalBrowser = null;
            mainPage = null;
        }

        // B. Volver a Iniciar (Abre y Loguea)
        console.log("   🔄 Re-iniciando sistema...");
        await iniciarSistema();
        console.log("   ✅ Mantenimiento finalizado.");

    }, 600000); // 600,000 ms = 10 minutos exactos
});
