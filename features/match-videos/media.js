(function(root) {
  'use strict';
  function decode(data,id) {
    const invalid=()=>{throw Object.assign(new Error('MATCH_VIDEO_INVALID_IMAGE'),{code:'MATCH_VIDEO_INVALID_IMAGE'});};
    if(data?.id!==id) invalid();
    if(data.status==='placeholder')return null;
    const maximum=256*1024;
    if(data.status!=='available'||data.mimeType!=='image/jpeg'||typeof data.base64!=='string'
        ||!data.base64.length||data.base64.length>4*Math.ceil(maximum/3)
        ||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64))invalid();
    let binary;try{binary=atob(data.base64);}catch(_){invalid();}
    if(!binary.length||binary.length>maximum)invalid();
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255
        ||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)invalid();
    return new Blob([bytes],{type:'image/jpeg'});
  }
  root.PaluruMatchVideoMedia=Object.freeze({decode});
})(globalThis);
