const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const renderBucket = 'smart-renders';

function fmt(value: unknown, fallback = 0){
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(fallback);
}

function buildPrompt(payload: any){
  const perimeterSource = payload?.perimeter || { name:'Perimetro casa', x:0, y:0, w:8, d:5.5, h:2.7 };
  const perimeter = `${perimeterSource.name || 'Perimetro casa'}: x ${fmt(perimeterSource.x)}, y ${fmt(perimeterSource.y)}, larghezza ${fmt(perimeterSource.w)}m, profondita ${fmt(perimeterSource.d)}m, altezza ${fmt(perimeterSource.h, 2.7)}m`;
  const rotation = Number(payload?.planRotation || 0);
  const rooms = (payload?.rooms || []).map((room: any) =>
    `${room.name || 'Stanza'}: x ${fmt(room.x)}, y ${fmt(room.y)}, larghezza ${fmt(room.w)}m, profondita ${fmt(room.d)}m, altezza ${fmt(room.h, 2.7)}m, pavimento/materiale ${room.material || 'wood'}`
  ).join('\n');
  const walls = (payload?.walls || []).map((wall: any) =>
    `${wall.name || 'Parete'}: da ${fmt(wall.x1)},${fmt(wall.y1)} a ${fmt(wall.x2)},${fmt(wall.y2)}, altezza ${fmt(wall.h, 2.7)}m`
  ).join('\n');
  const devices = (payload?.devices || []).map((device: any) =>
    `${device.name || 'Device'} (${device.kind || 'device'}) in ${device.room || 'stanza non assegnata'} a x ${fmt(device.x)}, y ${fmt(device.y)}`
  ).join('\n');
  const furnishings = (payload?.furnishings || []).map((item: any) =>
    `${item.name || 'Arredo'}: classe ${item.kind || 'furniture'}, stanza ${item.room || 'non assegnata'}, x ${fmt(item.x)}, y ${fmt(item.y)}, larghezza ${fmt(item.w)}m, profondita ${fmt(item.d)}m, rotazione ${fmt(item.rotation)} gradi, dettagli: ${item.notes || 'nessun dettaglio'}`
  ).join('\n');
  const assets = (payload?.assets || []).map((asset: any) => `${asset.name} (${asset.type})`).join(', ') || 'nessun file 3D caricato';

  return `Crea un render fotorealistico architettonico in vista perfettamente dall'alto, camera ortografica verticale, di una casa smart moderna basata su questa planimetria.

Stanze:
${rooms || 'nessuna stanza'}

Perimetro generale:
${perimeter}

Orientamento visuale:
planimetria ruotata di ${rotation} gradi verso destra rispetto ai dati originali.

Pareti:
${walls || 'nessuna parete'}

Dispositivi smart:
${devices || 'nessun dispositivo'}

Placeholder arredi:
${furnishings || 'nessun arredo placeholder'}

Arredi caricati dall'utente: ${assets}.

Usa perimetro, stanze e placeholder come vincoli principali: non spostare ambienti o arredi fuori dal perimetro e mantieni relazioni spaziali coerenti. Inventare con gusto solo i dettagli mancanti: texture, colori, piccoli complementi, illuminazione e materiali. Deve sembrare un vero render 3D premium, non una planimetria disegnata. Niente testo, niente icone, niente marker, niente persone, niente watermark.`;
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
        quality: 'low',
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!supabaseUrl || !serviceRoleKey){
      return new Response(JSON.stringify({ error:'SUPABASE_SERVICE_ROLE_KEY secret missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type':'application/json' },
      });
    }

    const bucketRes = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id:renderBucket, name:renderBucket, public:true }),
    });
    if(!bucketRes.ok){
      const err = await bucketRes.text();
      const duplicateBucket = bucketRes.status === 409 || /duplicate|already exists|resource already exists/i.test(err);
      if(duplicateBucket){
        console.info(`Storage bucket ${renderBucket} already exists`);
      }else{
      return new Response(JSON.stringify({ error:`Storage bucket failed: ${err}` }), {
        status: bucketRes.status,
        headers: { ...corsHeaders, 'Content-Type':'application/json' },
      });
      }
    }

    const bytes = Uint8Array.from(atob(imageBase64), ch => ch.charCodeAt(0));
    const fileName = `smart-home-${Date.now()}.png`;
    const uploadRes = await fetch(`${supabaseUrl}/storage/v1/object/${renderBucket}/${fileName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: bytes,
    });

    if(!uploadRes.ok){
      const err = await uploadRes.text();
      return new Response(JSON.stringify({ error:`Storage upload failed: ${err}` }), {
        status: uploadRes.status,
        headers: { ...corsHeaders, 'Content-Type':'application/json' },
      });
    }

    const imageUrl = `${supabaseUrl}/storage/v1/object/public/${renderBucket}/${fileName}`;

    return new Response(JSON.stringify({
      imageUrl,
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
