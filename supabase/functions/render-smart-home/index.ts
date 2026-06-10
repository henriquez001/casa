const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function fmt(value: unknown, fallback = 0){
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(fallback);
}

function buildPrompt(payload: any){
  const rooms = (payload?.rooms || []).map((room: any) =>
    `${room.name || 'Stanza'}: x ${fmt(room.x)}, y ${fmt(room.y)}, larghezza ${fmt(room.w)}m, profondita ${fmt(room.d)}m, altezza ${fmt(room.h, 2.7)}m, pavimento/materiale ${room.material || 'wood'}`
  ).join('\n');
  const walls = (payload?.walls || []).map((wall: any) =>
    `${wall.name || 'Parete'}: da ${fmt(wall.x1)},${fmt(wall.y1)} a ${fmt(wall.x2)},${fmt(wall.y2)}, altezza ${fmt(wall.h, 2.7)}m`
  ).join('\n');
  const devices = (payload?.devices || []).map((device: any) =>
    `${device.name || 'Device'} (${device.kind || 'device'}) in ${device.room || 'stanza non assegnata'} a x ${fmt(device.x)}, y ${fmt(device.y)}`
  ).join('\n');
  const assets = (payload?.assets || []).map((asset: any) => `${asset.name} (${asset.type})`).join(', ') || 'nessun file 3D caricato';

  return `Crea un render fotorealistico architettonico in vista perfettamente dall'alto, camera ortografica verticale, di una casa smart moderna basata su questa planimetria.

Stanze:
${rooms || 'nessuna stanza'}

Pareti:
${walls || 'nessuna parete'}

Dispositivi smart:
${devices || 'nessun dispositivo'}

Arredi caricati dall'utente: ${assets}.

Inventare con gusto i dettagli mancanti: divani, tappeti, letto, cucina, tavolo, sedie, texture, illuminazione, piante e complementi, mantenendo proporzioni e posizione delle stanze. Deve sembrare un vero render 3D premium, non una planimetria disegnata. Niente testo, niente icone, niente marker, niente persone, niente watermark.`;
}

Deno.serve(async req => {
  if(req.method === 'OPTIONS'){
    return new Response('ok', { headers: corsHeaders });
  }

  if(req.method !== 'POST'){
    return new Response(JSON.stringify({ error:'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type':'application/json' },
    });
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if(!openaiKey){
    return new Response(JSON.stringify({ error:'OPENAI_API_KEY secret missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type':'application/json' },
    });
  }

  try{
    const body = await req.json();
    const prompt = body.prompt || buildPrompt(body.payload);
    const size = body.size || '1536x1024';

    const imageRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt,
        size,
        quality: 'medium',
      }),
    });

    const imageJson = await imageRes.json();
    if(!imageRes.ok){
      return new Response(JSON.stringify({ error:imageJson.error?.message || 'Image generation failed' }), {
        status: imageRes.status,
        headers: { ...corsHeaders, 'Content-Type':'application/json' },
      });
    }

    const imageBase64 = imageJson.data?.[0]?.b64_json;
    if(!imageBase64){
      return new Response(JSON.stringify({ error:'Empty image response' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type':'application/json' },
      });
    }

    return new Response(JSON.stringify({
      imageBase64,
      imageDataUrl: `data:image/png;base64,${imageBase64}`,
      generatedAt: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type':'application/json' },
    });
  }catch(error){
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error:message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type':'application/json' },
    });
  }
});
