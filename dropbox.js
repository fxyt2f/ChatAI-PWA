/**
 * Dropbox APIと通信するためのヘルパーオブジェクト (V2 - アセット分離対応版)
 */
window.dropboxApi = {
    APP_KEY: '',
    METADATA_PATH: '/gemini_pwa_data.json',
    ASSETS_DIR_PATH: '/Gemini_PWA_Assets',
    DRAFTS_DIR_PATH: '/drafts',
    MAX_RETRY_COUNT: 3,
    BASE_RETRY_DELAY_MS: 1000,
    MAX_RETRY_DELAY_MS: 30000,
    _refreshPromise: null,

    /**
     * IndexedDBからトークン情報を取得する
     * @returns {Promise<object|null>} 保存されているトークン情報
     */
    async _getTokens() {
        if (!window.dbUtils) return null;
        const tokenData = await dbUtils.getSetting('dropboxTokens');
        return tokenData ? tokenData.value : null;
    },

    /**
     * 新しいトークン情報をIndexedDBに保存する
     * @param {object} tokens - 保存するトークン情報
     */
    async _saveTokens(tokens) {
        if (!window.dbUtils) return;
        await dbUtils.saveSetting('dropboxTokens', tokens);
    },

    setAppKey(appKey) {
        this.APP_KEY = (appKey || '').trim();
    },

    getAppKey(explicitAppKey = '') {
        const appKey = (
            explicitAppKey ||
            window.state?.settings?.dropboxAppKey ||
            sessionStorage.getItem('dropboxOAuthAppKey') ||
            this.APP_KEY ||
            ''
        ).trim();
        if (!appKey) {
            throw new Error('Dropbox App Keyが設定されていません。設定画面でDropbox App Keyを入力してください。');
        }
        return appKey;
    },

    /**
     * リフレッシュトークンを使って新しいアクセストークンを取得する
     * @param {string} refreshToken - リフレッシュトークン
     * @returns {Promise<object>} 新しいトークン情報
     */
    async _refreshAccessToken(refreshToken) {
        if (this._refreshPromise) {
            console.log('[Dropbox API] Token refresh already in progress. Waiting for shared refresh.');
            return this._refreshPromise;
        }

        this._refreshPromise = (async () => {
            console.log('[Dropbox API] Access token expired. Refreshing...');
            const url = 'https://api.dropboxapi.com/oauth2/token';
            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', refreshToken);
            params.append('client_id', this.getAppKey());

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params,
            });

            if (!response.ok) {
                const errorText = await this._readDropboxErrorText(response);
                const error = this._createDropboxError({
                    response,
                    domain: 'api',
                    endpoint: '/oauth2/token',
                    errorText
                });
                throw error;
            }

            const newAccessTokenData = await response.json();
            const tokens = await this._getTokens() || {};
            const newTokens = {
                ...tokens,
                ...newAccessTokenData,
                expires_at: Date.now() + (newAccessTokenData.expires_in - 300) * 1000,
            };

            await this._saveTokens(newTokens);
            console.log('[Dropbox API] Token refreshed and saved successfully.');
            return newTokens;
        })();

        try {
            return await this._refreshPromise;
        } finally {
            this._refreshPromise = null;
        }
    },

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    _isRetryableStatus(status) {
        return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
    },

    _getRetryDelayMs(response, retryCount) {
        const retryAfter = response?.headers?.get('Retry-After');
        if (retryAfter) {
            const retryAfterSeconds = Number(retryAfter);
            if (!Number.isNaN(retryAfterSeconds)) {
                return Math.min(retryAfterSeconds * 1000, this.MAX_RETRY_DELAY_MS);
            }
            const retryAfterDate = Date.parse(retryAfter);
            if (!Number.isNaN(retryAfterDate)) {
                return Math.min(Math.max(retryAfterDate - Date.now(), 0), this.MAX_RETRY_DELAY_MS);
            }
        }

        const exponentialDelay = this.BASE_RETRY_DELAY_MS * Math.pow(2, retryCount);
        const jitter = Math.floor(Math.random() * 250);
        return Math.min(exponentialDelay + jitter, this.MAX_RETRY_DELAY_MS);
    },

    async _readDropboxErrorText(response) {
        let errorText = `Dropbox API Error (${response.status}): ${response.statusText}`;
        try {
            const bodyText = await response.text();
            if (!bodyText) return errorText;
            try {
                const errorJson = JSON.parse(bodyText);
                return errorJson.error_summary || errorJson.error_description || JSON.stringify(errorJson.error || errorJson);
            } catch (parseError) {
                return bodyText;
            }
        } catch (readError) {
            return errorText;
        }
    },

    _createDropboxError({ response, domain, endpoint, errorText }) {
        const status = response?.status;
        const statusText = response?.statusText || '';
        const message = `[Dropbox ${domain}${endpoint}] ${errorText || `API Error (${status}): ${statusText}`}`;
        const error = new Error(message);
        error.status = status;
        error.statusText = statusText;
        error.endpoint = endpoint;
        error.domain = domain;
        error.retryAfter = response?.headers?.get('Retry-After') || null;
        return error;
    },

    /**
     * APIリクエストを送信する共通関数
     * @param {string} domain - 'api' or 'content'
     * @param {string} endpoint - APIエンドポイント
     * @param {object} options - fetch APIに渡すオプション
     * @param {number} retryCount - リトライ回数
     * @returns {Promise<any>} APIからのレスポンス
     */
    async _request(domain, endpoint, options = {}, retryCount = 0, hasRefreshedToken = false) {
        let tokens = await this._getTokens();
        if (!tokens || !tokens.access_token) {
            throw new Error("Dropbox is not connected.");
        }

        if (Date.now() >= tokens.expires_at) {
            if (!tokens.refresh_token) {
                await this._saveTokens(null);
                throw new Error("Session expired. Please reconnect to Dropbox.");
            }
            tokens = await this._refreshAccessToken(tokens.refresh_token);
        }

        const url = `https://${domain}.dropboxapi.com/2${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${tokens.access_token}`,
            ...options.headers,
        };

        try {
            const response = await fetch(url, { ...options, headers });

            if (!response.ok) {
                if (response.status === 401 && !hasRefreshedToken) {
                    if (!tokens.refresh_token) {
                        await this._saveTokens(null);
                        throw new Error("Session expired. Please reconnect to Dropbox.");
                    }
                    console.log('[Dropbox API] Received 401, forcing token refresh and retrying...');
                    tokens = await this._refreshAccessToken(tokens.refresh_token);
                    return this._request(domain, endpoint, options, retryCount, true);
                }

                const errorText = await this._readDropboxErrorText(response);
                const error = this._createDropboxError({ response, domain, endpoint, errorText });

                if (this._isRetryableStatus(response.status) && retryCount < this.MAX_RETRY_COUNT) {
                    const delayMs = this._getRetryDelayMs(response, retryCount);
                    console.warn(`[Dropbox API] Retryable error for ${domain}${endpoint} (status: ${response.status}). Retrying ${retryCount + 1}/${this.MAX_RETRY_COUNT} in ${delayMs}ms.`, error.message);
                    await this._sleep(delayMs);
                    return this._request(domain, endpoint, options, retryCount + 1, hasRefreshedToken);
                }

                throw error;
            }

            if (endpoint === '/files/download') {
                return response.blob();
            }
            
            const responseText = await response.text();
            return responseText ? JSON.parse(responseText) : {};

        } catch (error) {
            if (!error.status && retryCount < this.MAX_RETRY_COUNT) {
                const delayMs = this._getRetryDelayMs(null, retryCount);
                console.warn(`[Dropbox API] Network error for ${domain}${endpoint}. Retrying ${retryCount + 1}/${this.MAX_RETRY_COUNT} in ${delayMs}ms.`, error);
                await this._sleep(delayMs);
                return this._request(domain, endpoint, options, retryCount + 1, hasRefreshedToken);
            }

            // "not found"エラーは呼び出し元で正常ケースとして処理するため、コンソールへのエラー出力を抑制する
            if (!error.message.includes('not_found')) {
                console.error(`[Dropbox API] Request error for ${domain}${endpoint}:`, {
                    status: error.status,
                    statusText: error.statusText,
                    endpoint: error.endpoint || endpoint,
                    retryAfter: error.retryAfter,
                    message: error.message
                });
            }
            throw error;
        }
    },

    // --- Public API ---

    async testConnection() {
        return this._request('api', '/users/get_current_account', { method: 'POST' });
    },

    async uploadMetadata(content) {
        const args = { path: this.METADATA_PATH, mode: 'overwrite', mute: true };
        return this._request('content', '/files/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': JSON.stringify(args),
            },
            body: content,
        });
    },

    async downloadMetadata() {
        const args = { path: this.METADATA_PATH };
        try {
            const blob = await this._request('content', '/files/download', {
                method: 'POST',
                headers: { 'Dropbox-API-Arg': JSON.stringify(args) },
            });
            return blob.text();
        } catch (error) {
            // "path/not_found" という文字列を含むエラーの場合のみ、ファイルなし(null)として扱う
            if (error && error.message && error.message.includes('path/not_found')) {
                return null;
            }
            // それ以外のエラーは、一時的なネットワークエラーの可能性があるので、そのままスローする
            throw error;
        }
    },


    async uploadAsset(assetBlob, assetId) {
        const path = `${this.ASSETS_DIR_PATH}/${assetId}`;
        const args = { path: path, mode: 'overwrite', mute: true };
        return this._request('content', '/files/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': JSON.stringify(args),
            },
            body: assetBlob,
        });
    },

    async downloadAsset(assetId) {
        const path = `${this.ASSETS_DIR_PATH}/${assetId}`;
        const args = { path: path };
        try {
            return await this._request('content', '/files/download', {
                method: 'POST',
                headers: { 'Dropbox-API-Arg': JSON.stringify(args) },
            });
        } catch (error) {
            if (error.message.includes('path/not_found')) {
                console.warn(`[Dropbox API] Asset not found on cloud: ${assetId}`);
                return null;
            }
            throw error;
        }
    },

    encodeDraftKey(contextKey) {
        const utf8Bytes = new TextEncoder().encode(String(contextKey || 'default'));
        let binary = '';
        utf8Bytes.forEach(byte => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
    },

    getInputDraftPath(contextKey) {
        return `${this.DRAFTS_DIR_PATH}/${this.encodeDraftKey(contextKey)}.json`;
    },

    async ensureDraftsFolder() {
        try {
            await this._request('api', '/files/get_metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.DRAFTS_DIR_PATH }),
            });
        } catch (error) {
            if (error.message && error.message.includes('path/not_found')) {
                try {
                    await this._request('api', '/files/create_folder_v2', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: this.DRAFTS_DIR_PATH, autorename: false }),
                    });
                } catch (createError) {
                    if (!createError.message?.includes('path/conflict/folder')) {
                        throw createError;
                    }
                }
                return;
            }
            throw error;
        }
    },

    async uploadInputDraftToDropbox(draftRecord) {
        if (!draftRecord || draftRecord.kind !== 'inputDraft' || !draftRecord.contextKey) {
            throw new Error('Invalid input draft record.');
        }
        await this.ensureDraftsFolder();
        const args = {
            path: this.getInputDraftPath(draftRecord.contextKey),
            mode: 'overwrite',
            mute: true
        };
        return this._request('content', '/files/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': JSON.stringify(args),
            },
            body: JSON.stringify(draftRecord),
        });
    },

    async downloadInputDraftFromDropbox(contextKey) {
        const args = { path: this.getInputDraftPath(contextKey) };
        try {
            const blob = await this._request('content', '/files/download', {
                method: 'POST',
                headers: { 'Dropbox-API-Arg': JSON.stringify(args) },
            });
            return JSON.parse(await blob.text());
        } catch (error) {
            if (error.message && error.message.includes('path/not_found')) {
                return null;
            }
            throw error;
        }
    },

    async markInputDraftDeletedInDropbox(draftRecord) {
        return this.uploadInputDraftToDropbox({
            ...draftRecord,
            text: '',
            deleted: true,
            updatedAt: draftRecord?.updatedAt || Date.now()
        });
    },

    async listAssets() {
        let allEntries = [];
        let hasMore = true;
        let cursor = null;
        const path = this.ASSETS_DIR_PATH;

        try {
            while (hasMore) {
                let response;
                if (cursor) {
                    response = await this._request('api', '/files/list_folder/continue', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cursor: cursor }),
                    });
                } else {
                    response = await this._request('api', '/files/list_folder', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: path, recursive: false, limit: 2000 }),
                    });
                }

                if (response.entries) {
                    allEntries = allEntries.concat(response.entries);
                }
                
                hasMore = response.has_more;
                cursor = response.cursor;
            }
            return allEntries;
        } catch (error) {
            if (error.message.includes('path/not_found')) {
                return []; // フォルダが存在しない場合は空配列を返す
            }
            throw error;
        }
    },


    async ensureAssetsFolderExists() {
        try {
            // フォルダのメタデータを取得しようと試みる
            await this._request('api', '/files/get_metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.ASSETS_DIR_PATH }),
            });
        } catch (error) {
            if (error.message.includes('path/not_found')) {
                // フォルダが存在しない場合のみ作成する
                console.log(`[Dropbox API] Assets folder not found. Creating folder: ${this.ASSETS_DIR_PATH}`);
                await this._request('api', '/files/create_folder_v2', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: this.ASSETS_DIR_PATH, autorename: false }),
                });
            } else {
                // その他のエラーはそのままスローする
                throw error;
            }
        }
    },

    async deleteAssets(assetIds) {
        if (!assetIds || assetIds.length === 0) return;
        const entries = assetIds.map(id => ({ path: `${this.ASSETS_DIR_PATH}/${id}` }));

        // Step 1: Start the delete job
        const initialResponse = await this._request('api', '/files/delete_batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries: entries }),
        });

        // If it's not an async job, we're done
        if (initialResponse['.tag'] !== 'async_job_id') {
            console.log('[Dropbox API] Delete job completed synchronously or no job ID returned.', initialResponse);
            return;
        }

        const jobId = initialResponse.async_job_id;
        console.log(`[Dropbox API] Started async delete job: ${jobId}. Polling for completion...`);

        // Step 2: Poll for job completion
        const maxAttempts = 60; // Poll for up to 2 minutes (60 attempts * 2s)
        let attempts = 0;
        let jobStatus;

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        do {
            await sleep(2000); // Wait 2 seconds between checks
            attempts++;

            try {
                jobStatus = await this._request('api', '/files/delete_batch/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ async_job_id: jobId }),
                });
                console.log(`[Dropbox API] Polling delete job #${attempts}: Status is '${jobStatus['.tag']}'`);
            } catch (pollError) {
                // If polling fails, we can't know the status, so we must throw
                console.error(`[Dropbox API] Polling for delete job failed.`, pollError);
                throw new Error(`Polling for delete job ${jobId} failed: ${pollError.message}`);
            }

        } while (jobStatus['.tag'] === 'in_progress' && attempts < maxAttempts);

        // Step 3: Check final status
        if (jobStatus['.tag'] === 'complete') {
            console.log('[Dropbox API] Async delete job completed successfully.');
            return; // Success!
        } else {
            const errorMessage = `Async delete job did not complete successfully. Final status: ${jobStatus['.tag']}. Details: ${JSON.stringify(jobStatus)}`;
            console.error(`[Dropbox API] ${errorMessage}`);
            throw new Error(errorMessage);
        }
    },


    async getAccessToken(code, redirectUri, codeVerifier, appKey = '') {
        console.log('[Dropbox API] Requesting access token...');
        const url = 'https://api.dropboxapi.com/oauth2/token';
        const clientId = this.getAppKey(appKey);
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
        params.append('client_id', clientId);
        params.append('code_verifier', codeVerifier);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params,
        });

        if (!response.ok) {
            const errorJson = await response.json();
            throw new Error(errorJson.error_description || `Token API Error (${response.status})`);
        }

        const tokenData = await response.json();
        tokenData.expires_at = Date.now() + (tokenData.expires_in - 300) * 1000;
        
        await this._saveTokens(tokenData); 
        
        return tokenData;
    },

    async disconnect() {
        const tokens = await this._getTokens();
        if (tokens && tokens.access_token) {
            try {
                await this._request('api', '/auth/token/revoke', { method: 'POST' });
            } catch (error) {
                console.warn("Failed to revoke token on Dropbox side, but clearing local tokens anyway.", error);
            }
        }
        await dbUtils.saveSetting('dropboxTokens', null);
        console.log('[Dropbox API] Disconnected and local tokens cleared.');
    },

    async uploadAssetsInBatches(assetsToUpload, progressCallback) {
        if (!assetsToUpload || assetsToUpload.length === 0) {
            console.log('[Dropbox API] No assets to upload in batch.');
            return;
        }

        const total = assetsToUpload.length;
        console.log(`[Dropbox API] Starting batch upload for ${total} assets.`);

        const BATCH_SIZE = 5;
        const DELAY_MS = 1000;
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < total; i++) {
            const { assetId, asset } = assetsToUpload[i];
            
            if (progressCallback) {
                progressCallback(i + 1, total);
            }

            try {
                await this.uploadAsset(asset.blob, assetId);
                console.log(`[Dropbox API] Batch upload: Successfully uploaded ${assetId} (${i + 1}/${total})`);
            } catch (error) {
                console.error(`[Dropbox API] Batch upload: Failed to upload ${assetId}.`, error);
                throw new Error(`Failed to upload asset ${assetId} during batch operation. Aborting. Original error: ${error.message}`);
            }

            if ((i + 1) % BATCH_SIZE === 0 && i < total - 1) {
                console.log(`[Dropbox API] Batch limit reached. Waiting for ${DELAY_MS}ms...`);
                await sleep(DELAY_MS);
            }
        }
        console.log(`[Dropbox API] Batch upload completed for ${total} assets.`);
    },

    // --- Lock File Operations ---

    async uploadLockFile(operationType) {
        if (!operationType || !['push', 'pull'].includes(operationType)) {
            throw new Error('Lock file operation type must be "push" or "pull".');
        }
        console.log(`[Dropbox API] Uploading lock file for operation: ${operationType}`);
        const lockData = JSON.stringify({
            timestamp: new Date().toISOString(),
            operation: operationType
        });
        const path = '/.sync_lock';
        try {
            await this._request('content', '/files/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'Dropbox-API-Arg': JSON.stringify({
                        path: path,
                        mode: 'overwrite',
                        autorename: false,
                        mute: true
                    })
                },
                body: lockData
            });
        } catch (error) {
            console.error('Lock file upload failed:', error);
            throw new Error('ロックファイルのアップロードに失敗しました。');
        }
    },


    async deleteLockFile() {
        const path = '/.sync_lock';
        console.log('[Dropbox API] Deleting lock file...');
        try {
            return await this._request('api', '/files/delete_v2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path }),
            });
        } catch (error) {
            // "not_found" を含むエラーは正常ケースとして扱う
            if (error.message.includes('not_found')) {
                console.warn('[Dropbox API] Lock file not found during deletion, which is okay.');
                return null;
            }
            // Rethrow other errors
            throw error;
        }
    },


    async checkLockFile() {
        const path = '/.sync_lock';
        try {
            const blob = await this._request('content', '/files/download', {
                method: 'POST',
                headers: { 'Dropbox-API-Arg': JSON.stringify({ path: path }) },
            });
            const content = await blob.text();
            const data = JSON.parse(content);
            console.log('[Dropbox API] Lock file found.', data);
            return data; // ファイルの内容 (e.g., { operation: 'push' }) を返す
        } catch (error) {
            if (error.message.includes('path/not_found')) {
                console.log('[Dropbox API] Lock file not found.');
                return null; // ファイルが存在しない場合は null を返す
            }
            // Rethrow other network or API errors
            throw error;
        }
    }
};
