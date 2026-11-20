let model, tokenizer;
let queue = Promise.resolve();

async function load(spec, allowDownload) {
    if (!await globalThis.navigator.gpu?.requestAdapter()) throw new Error('WebGPUを利用できません。');
    const { AutoConfig, AutoModel, AutoTokenizer, env } = await import(spec.runtime);
    const cache = await caches.open(spec.cacheName);
    env.cacheKey = spec.cacheName;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.useWasmCache = true;
    const networkFetch = globalThis.fetch.bind(globalThis);
    env.fetch = async (resource, options) => {
        const url = new URL(resource instanceof Request ? resource.url : resource);
        if (url.origin !== 'https://huggingface.co') return networkFetch(resource, options);
        const root = '/' + spec.model + '/resolve/';
        if (!url.pathname.startsWith(root)) return new Response(null, { status: 404 });
        // The tokenizer's metadata probe defaults to main in Transformers.js 4.3.1.
        url.pathname = root + spec.revision + '/' + url.pathname.slice(root.length).split('/').slice(1).join('/');
        const stored = await cache.match(url);
        if (stored) {
            const range = new Headers(options?.headers || (resource instanceof Request ? resource.headers : undefined)).get('Range');
            if (range === 'bytes=0-0') {
                const size = stored.headers.get('Content-Length') || (await stored.blob()).size;
                return new Response(new Uint8Array(1), { status: 206,
                    headers: { 'Content-Length': '1', 'Content-Range': 'bytes 0-0/' + size } });
            }
            return stored;
        }
        if (!allowDownload) return new Response(null, { status: 404 });
        return networkFetch(url, options);
    };
    let lastUpdate = 0;
    const options = { revision: spec.revision, progress_callback(event) {
        if (!allowDownload || !event.file || performance.now() - lastUpdate < 300) return;
        lastUpdate = performance.now();
        postMessage({ progress: event.file + (Number.isFinite(event.progress) ? ' · ' + Math.floor(event.progress) + '%' : '') });
    } };
    const config = await AutoConfig.from_pretrained(spec.model, options);
    config.vision_config = config.audio_config = null;
    model = await AutoModel.from_pretrained(spec.model, { ...options, config, device: 'webgpu', dtype: spec.dtype });
    tokenizer = await AutoTokenizer.from_pretrained(spec.model, options);
    if (!await cache.match(spec.marker)) await cache.put(spec.marker, new Response('ready'));
}

async function embed({ spec, texts, query }) {
    if (!model || !tokenizer) throw new Error('モデルが初期化されていません。');
    const inputs = texts.map(({ title, text }) => query ? spec.queryPrefix + text :
        'title: ' + (title || 'none') + ' | text: ' + text);
    const { sentence_embedding: output } = await model(await tokenizer(inputs, { padding: true }));
    if (output.dims[0] !== texts.length || output.dims[1] !== spec.dimensions) throw new Error('ベクトルの形状が一致しません。');
    const vectors = Array.from({ length: texts.length }, (_, index) => {
        const values = Float32Array.from(output.data.subarray(index * spec.dimensions, (index + 1) * spec.dimensions));
        const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
        if (!Number.isFinite(norm) || Math.abs(norm - 1) > 0.002) throw new Error('正規化されたベクトルを取得できません。');
        return values;
    });
    return vectors;
}

self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
        try {
            const result = data.action === 'load' ? await load(data.spec, data.allowDownload) : await embed(data);
            postMessage({ id: data.id, result }, result?.map(vector => vector.buffer) || []);
        } catch (error) {
            postMessage({ id: data.id, error: String(error.message || error) });
        }
    });
};
