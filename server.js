const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app); // 1. Önce temel HTTP sunucusunu oluştur
const io = new Server(server, {        // 2. Socket.io'yu bu sunucuya bağla
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// 3. KRİTİK SIRALAMA: Statik dosyaları sunma emri io tanımlandıktan SONRA gelmeli
// Bu sayede /socket.io/socket.io.js dosyası çakışmadan servis edilebilir.
app.use(express.static(__dirname + '/public'));

const nesneler = [];
const MAX_NESNE = 100;

// OSM Verisi Çekme Endpoint'i
app.get('/osm-verisi', async (req, res) => {
    const { lat, lng, yari_cap = 200 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat/lng gerekli' });

    const sorgu = `
        [out:json][timeout:10];
        (
            node["highway"="crossing"](around:${yari_cap},${lat},${lng});
            node["kerb"="lowered"](around:${yari_cap},${lat},${lng});
            node["tactile_paving"="yes"](around:${yari_cap},${lat},${lng});
            node["highway"="bus_stop"](around:${yari_cap},${lat},${lng});
            node["amenity"="bench"](around:${yari_cap},${lat},${lng});
            node["highway"="traffic_signals"](around:${yari_cap},${lat},${lng});
            node["kerb"="raised"](around:${yari_cap},${lat},${lng});
        );
        out body;
    `;

    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(sorgu)}`;

    https.get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
            try {
                const json = JSON.parse(data);
                res.json(json);
            } catch (e) {
                res.status(500).json({ error: 'OSM parse hatası' });
            }
        });
    }).on('error', (e) => {
        res.status(500).json({ error: e.message });
    });
});

// Socket.io Olayları
io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);
    socket.emit('nesne_listesi', nesneler);

    socket.on('gozcu_telemetri', (data) => {
        console.log('Telemetri:', data);
        io.emit('harita_guncelle', data);
    });

    socket.on('nesne_tespit', (data) => {
        console.log('Nesne tespit:', data);
        const mevcutIndex = nesneler.findIndex(n =>
            n.nesne === data.nesne &&
            Math.abs(n.lat - data.lat) < 0.0001 &&
            Math.abs(n.lng - data.lng) < 0.0001
        );
        if (mevcutIndex >= 0) {
            nesneler[mevcutIndex] = data;
        } else {
            nesneler.push(data);
            if (nesneler.length > MAX_NESNE) nesneler.shift();
        }
        io.emit('nesne_guncelle', data);
    });

    socket.on('kamera_verisi', (data) => {
        socket.broadcast.emit('canli_kamera', data);
    });

    socket.on('disconnect', () => {
        console.log('Bağlantı kesildi:', socket.id);
    });
});

// Railway Port Ayarı
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`GÖZCÜ SUNUCU AKTİF PORT: ${PORT}`);
});