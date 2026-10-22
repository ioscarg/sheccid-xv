// Función serverless de Vercel: única puerta al Supabase para el panel de invitados.
// Usa la service_role key (solo en variables de entorno de Vercel, nunca en el frontend).
const { timingSafeEqual } = require('crypto');

const SUPA = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = process.env.PANEL_PASSWORD;

const CAMPOS = 'id,nombre_corto,boletos,token,link_enviado,confirmado';

function passwordValida(recibida) {
  if (!PASS || typeof recibida !== 'string') return false;
  const a = Buffer.from(recibida);
  const b = Buffer.from(PASS);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function sb(ruta, opciones = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${ruta}`, {
    ...opciones,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opciones.headers || {}),
    },
  });
  const datos = await r.json().catch(() => null);
  if (!r.ok) throw new Error((datos && datos.message) || `Supabase respondió ${r.status}`);
  return datos;
}

function validarInvitado({ nombre_corto, boletos }) {
  const nombre = String(nombre_corto || '').trim();
  const b = parseInt(boletos, 10);
  if (!nombre) return { error: 'Falta el nombre' };
  if (!(b >= 1 && b <= 20)) return { error: 'Boletos debe estar entre 1 y 20' };
  return { nombre, boletos: b };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const body = req.body || {};
  if (!passwordValida(body.password)) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const id = body.id ? encodeURIComponent(String(body.id)) : null;

  try {
    switch (body.action) {
      case 'list': {
        const datos = await sb(`invitados?select=${CAMPOS}&order=nombre_corto.asc`);
        return res.json(datos);
      }
      case 'create': {
        const v = validarInvitado(body);
        if (v.error) return res.status(400).json({ error: v.error });
        // El token lo genera la BD; nunca se acepta desde el cliente
        const datos = await sb(`invitados?select=${CAMPOS}`, {
          method: 'POST',
          body: JSON.stringify({ nombre_corto: v.nombre, boletos: v.boletos }),
        });
        return res.json(datos[0]);
      }
      case 'update': {
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const v = validarInvitado(body);
        if (v.error) return res.status(400).json({ error: v.error });
        // Solo nombre y boletos: el token no se toca
        const datos = await sb(`invitados?id=eq.${id}&select=${CAMPOS}`, {
          method: 'PATCH',
          body: JSON.stringify({ nombre_corto: v.nombre, boletos: v.boletos }),
        });
        return res.json(datos[0]);
      }
      case 'mark_sent': {
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await sb(`invitados?id=eq.${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ link_enviado: true }),
          headers: { Prefer: 'return=minimal' },
        });
        return res.json({ ok: true });
      }
      case 'delete': {
        if (!id) return res.status(400).json({ error: 'Falta id' });
        await sb(`invitados?id=eq.${id}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        });
        return res.json({ ok: true });
      }
      case 'list_rsvps': {
        // Solo lectura: mensajes que dejan los invitados en la invitación
        const datos = await sb('rsvps?select=id,guest_name,message,created_at&order=created_at.desc');
        return res.json(datos);
      }
      default:
        return res.status(400).json({ error: 'Acción inválida' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
