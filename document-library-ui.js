window.DocumentLibraryUI = (() => {
    const formats = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'xml', 'html']);
    const fileIcons = { pdf: 'pdf', docx: 'article', txt: 'text', md: 'article',
        csv: 'table', tsv: 'table', json: 'code', yaml: 'code', xml: 'code', html: 'code' };
    const fileOutline = 'M6 3h8l4 4v14H6z M14 3v5h4';
    const iconPaths = {
        pdf: fileOutline + ' M9 17c2-5 3-7 3-5s1 4 4 4c-3-1-5 0-7 1z',
        article: fileOutline + ' M9 11h6 M9 14h6 M9 17h4',
        text: fileOutline + ' M9 12h6 M9 16h6',
        table: fileOutline + ' M9 11h6v6H9z M9 14h6 M12 11v6',
        code: fileOutline + ' M10.5 12l-2 2 2 2 M13.5 12l2 2-2 2',
        more: 'M12 5v.1 M12 12v.1 M12 19v.1',
        folder: 'M3 7V5h7l2 2h9v3 M3 7v12h16l3-9H6l-3 9',
        back: 'M19 12H5 M12 5l-7 7 7 7',
        add: 'M12 5v14 M5 12h14',
        search: 'M20 20l-4.5-4.5 M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z',
        close: 'M6 6l12 12 M18 6L6 18',
        unlink: 'M10 7H7a5 5 0 0 0 0 10h3 M14 7h3a5 5 0 0 1 0 10h-3 M5 3l14 18',
        replace: fileOutline + ' M12 17v-6 M9.5 13.5L12 11l2.5 2.5',
        delete: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 10v7 M14 10v7'
    };
    const extractsPerPage = 6;
    let controls, picker, workspace, rowMenu;

    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text != null) element.textContent = text;
        if (className) element.className = className;
        return element;
    }

    function button(text, onClick, className) {
        const element = node('button', text, className);
        element.type = 'button';
        element.addEventListener('click', onClick);
        return element;
    }

    function icon(name) {
        const svg = 'http://www.w3.org/2000/svg';
        const element = document.createElementNS(svg, 'svg');
        const path = document.createElementNS(svg, 'path');
        element.classList.add('document-library-icon');
        element.setAttribute('aria-hidden', 'true');
        element.setAttribute('viewBox', '0 0 24 24');
        element.setAttribute('fill', 'none');
        element.setAttribute('stroke', 'currentColor');
        element.setAttribute('stroke-width', name === 'more' ? '2.8' : '1.7');
        element.setAttribute('stroke-linecap', 'round');
        element.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('d', iconPaths[name]);
        element.append(path);
        return element;
    }

    function fileSize(size) {
        if (size < 1000) return size + ' B';
        if (size < 1000000) return (size / 1000).toFixed(1).replace(/\.0$/, '') + ' KB';
        return (size / 1000000).toFixed(1).replace(/\.0$/, '') + ' MB';
    }

    function ownsPicker(view) {
        const state = window.state;
        return picker === view && controls.picker.open && state.currentScreen === 'chat' &&
            state.currentMessages === view.messages && (state.currentChatId === view.chatId ||
                (view.chatId == null && window.dbUtils.chatSaveOwners?.get(view.messages)?.id === state.currentChatId));
    }

    function ownsWorkspace(view) {
        return workspace === view && !controls.workspace.hidden && window.state.currentScreen === 'chat';
    }

    function owns(view) {
        return view.kind === 'picker' ? ownsPicker(view) : ownsWorkspace(view);
    }

    function notice(view, message) {
        if (owns(view)) (view.kind === 'picker' ? controls.pickerNotice : controls.notice).textContent = message;
    }

    function closeMenu(restoreFocus = false) {
        if (!rowMenu) return;
        const { anchor, menu } = rowMenu;
        rowMenu = null;
        menu.hidden = true;
        anchor.setAttribute('aria-expanded', 'false');
        anchor.closest('.document-library-collection-row')?.classList.remove('menu-active');
        if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    }

    function openMenu(view, anchor, entry) {
        if (view.mutating || !owns(view)) return;
        if (rowMenu?.anchor === anchor) { closeMenu(true); return; }
        closeMenu();
        const linked = view.kind === 'picker';
        const menu = linked ? controls.pickerMenu : controls.menu;
        const container = linked ? controls.picker : controls.workspace;
        const actions = linked
            ? [['unlink', 'このチャットから解除', () => setLinked(view, entry, false)]]
            : [['replace', '差し替え', () => chooseReplacement(view, entry)],
                ['delete', '削除', () => deleteDocument(view, entry)]];
        menu.replaceChildren(...actions.map(([symbol, label, action]) => {
            const item = button(null, () => { closeMenu(true); void action(); });
            item.append(icon(symbol), document.createTextNode(label));
            item.setAttribute('role', 'menuitem');
            if (symbol === 'delete') item.className = 'history-item-menu-delete';
            return item;
        }));
        menu.setAttribute('aria-label', entry.fileName + ' の操作');
        rowMenu = { menu, anchor, container };
        anchor.setAttribute('aria-expanded', 'true');
        anchor.closest('.document-library-collection-row')?.classList.add('menu-active');
        menu.hidden = false;
        window.uiUtilsV136.positionRowMenu(menu, anchor, container);
        menu.firstElementChild.focus({ preventScroll: true });
    }

    function renderRows(view, list, entries, openEntry, menuId) {
        const focused = list.contains(document.activeElement) ? document.activeElement : null;
        const focusedId = focused?.closest('li')?.dataset.documentId;
        if (rowMenu && list.contains(rowMenu.anchor)) closeMenu();
        let restoreFocus;
        const fragment = document.createDocumentFragment();
        for (const entry of entries) {
            const row = node('li', null, 'document-library-row');
            row.dataset.documentId = entry.id;
            const main = openEntry
                ? button(null, () => openEntry(entry), 'document-library-file')
                : node('div', null, 'document-library-file');
            main.dataset.kind = ['csv', 'tsv'].includes(entry.format) ? 'table' : entry.format;
            main.title = entry.fileName;
            main.append(icon(fileIcons[entry.format] || 'text'),
                node('span', entry.fileName, 'document-library-file-name'),
                node('span', fileSize(entry.size), 'document-library-file-size'));
            const match = view.matches?.get(entry.id);
            if (match) main.append(node('span', window.DocumentSearch.formatLocation(match.location) +
                ' · ' + match.excerpt, 'document-library-file-excerpt'));
            if (view.kind === 'workspace') {
                row.classList.add('document-library-collection-row');
                const selected = !view.reference && view.selected?.versionId === entry.versionId;
                row.dataset.selected = String(selected);
                main.setAttribute('aria-pressed', String(selected));
            } else if (openEntry) {
                main.disabled = view.mutating;
                main.setAttribute('aria-label', entry.fileName + ' をこのチャットに追加');
            }
            row.append(main);
            if (menuId) {
                const inPicker = view.kind === 'picker';
                const style = inPicker ? 'chat-dialog-icon-button' : 'chat-sidebar-item-menu';
                const more = button(null, () => openMenu(view, more, entry), style + ' document-library-more');
                const glyph = inPicker ? icon('more') : node('span', 'more_vert', 'material-symbols-outlined');
                glyph.setAttribute('aria-hidden', 'true');
                more.append(glyph);
                more.setAttribute('aria-label', entry.fileName + ' の操作');
                more.setAttribute('aria-controls', menuId);
                more.setAttribute('aria-haspopup', 'menu');
                more.setAttribute('aria-expanded', 'false');
                more.disabled = view.mutating;
                row.append(more);
                if (entry.id === focusedId && focused.classList.contains('document-library-more')) restoreFocus = more;
            }
            if (entry.id === focusedId && focused.classList.contains('document-library-file')) restoreFocus = main;
            fragment.append(row);
        }
        list.replaceChildren(fragment);
        restoreFocus?.focus({ preventScroll: true });
    }

    function byName(a, b) {
        return a.fileName.localeCompare(b.fileName, 'ja', { numeric: true });
    }

    function sameRows(previous, next) {
        return previous.length === next.length && previous.every((entry, i) => {
            const current = next[i];
            return entry.id === current.id && entry.versionId === current.versionId &&
                entry.fileName === current.fileName && entry.size === current.size;
        });
    }

    function renderPicker(view) {
        const selecting = view.selecting;
        controls.pickerHeading.textContent = selecting ? 'ライブラリから追加' : 'このチャットのファイル';
        controls.pickerCount.hidden = selecting;
        controls.pickerCount.textContent = view.linked.length + '件';
        controls.pickerBack.hidden = !selecting;
        controls.pickerActions.hidden = selecting;
        controls.pickerSearch.hidden = !selecting;
        controls.pickerSelect.disabled = view.mutating;
        controls.pickerUpload.disabled = view.mutating;
        renderPickerRows(view);
    }

    function renderPickerRows(view) {
        const selecting = view.selecting;
        const query = selecting ? normalizedName(controls.pickerQuery.value) : '';
        const linked = new Set(view.linked.map(entry => entry.id));
        const entries = selecting ? view.entries.filter(entry =>
            !linked.has(entry.id) && (!query || normalizedName(entry.fileName).includes(query))) : view.linked;
        controls.pickerEmpty.hidden = !selecting || !view.loaded || entries.length > 0;
        controls.pickerEmpty.textContent = !selecting ? '' :
            (query ? '該当するファイルがありません。' : '追加できるファイルはありません。');
        renderRows(view, controls.pickerList, entries,
            selecting ? entry => void setLinked(view, entry, true) : null,
            selecting ? null : controls.pickerMenu.id);
    }

    function chatOwner(view) {
        const owner = window.dbUtils.chatSaveOwners?.get(view.messages);
        return owner?.id === view.chatId ? owner : null;
    }

    async function refreshPicker(view) {
        if (!ownsPicker(view)) return;
        view.chatId = window.state.currentChatId;
        const request = ++view.refreshVersion;
        const id = view.chatId;
        try {
            const [entries, linked] = await Promise.all([
                window.dbUtils.listLibraryDocuments(),
                window.dbUtils.getChatDocuments(id, chatOwner(view))
            ]);
            if (!ownsPicker(view) || request !== view.refreshVersion || id !== view.chatId) return;
            const sorted = entries.sort(byName);
            const links = linked.filter(Boolean).sort(byName);
            const changed = !view.loaded || !sameRows(view.entries, sorted) || !sameRows(view.linked, links);
            view.loaded = true;
            view.entries = sorted;
            view.linked = links;
            if (changed) renderPicker(view);
        } catch {
            if (request === view.refreshVersion) notice(view, 'ファイルの一覧を読み取れませんでした。');
        }
    }

    function openPicker() {
        if (picker || workspace || window.state.currentScreen !== 'chat') return;
        const view = picker = { kind: 'picker', chatId: window.state.currentChatId, messages: window.state.currentMessages,
            entries: [], linked: [], refreshVersion: 0, selecting: false, loaded: false, mutating: false };
        controls.pickerNotice.textContent = '';
        controls.pickerQuery.value = '';
        renderPicker(view);
        window.uiUtilsV136.prepareChatDialog(controls.picker);
        controls.picker.showModal();
        void refreshPicker(view);
    }

    function closePicker() {
        if (picker) closeMenu();
        picker = null;
        controls.picker.removeAttribute('data-file-drop');
        if (controls.picker.open) controls.picker.close();
    }

    function pickerSelection(selecting) {
        if (!picker || picker.mutating) return;
        picker.selecting = selecting;
        notice(picker, '');
        renderPicker(picker);
        const focus = selecting ? controls.pickerTitle : controls.pickerSelect;
        focus.focus({ preventScroll: true });
    }

    async function updateLinks(view, entries, mode) {
        if (!ownsPicker(view)) return;
        view.chatId = window.state.currentChatId;
        const chatId = await window.appLogic.setCurrentChatDocuments(entries.map(entry => entry.id), mode);
        if (picker !== view || window.state.currentMessages !== view.messages || window.state.currentChatId !== chatId) return;
        view.chatId = chatId;
        view.selecting = false;
    }

    function setLinked(view, entry, checked) {
        return mutate(view, () => updateLinks(view, [entry], checked ? 'add' : 'remove'));
    }

    function normalizedName(text) { return text.normalize('NFKC').trim().toLocaleLowerCase('ja'); }

    function renderCollection(view) {
        const query = normalizedName(controls.query.value);
        const mode = controls.searchMode.value;
        const entries = view.entries.filter(entry => !query || view.matches?.has(entry.id) ||
            (mode !== 'body' && normalizedName(entry.fileName).includes(query)));
        if (controls.sort.value === 'updated') entries.sort((a, b) => b.updatedAt - a.updatedAt || byName(a, b));
        controls.empty.hidden = !view.loaded || view.searchPending || entries.length !== 0;
        controls.empty.textContent = query ? '該当するファイルがありません。' : '登録済みのファイルはありません。';
        const scrollTop = controls.collectionScroll.scrollTop;
        renderRows(view, controls.list, entries, entry => {
            if (view.selected?.versionId === entry.versionId) closePreview(view);
            else void preview(view, entry, { chunkId: view.matches?.get(entry.id)?.chunkId });
        }, controls.menu.id);
        controls.collectionScroll.scrollTop = scrollTop;
    }

    async function refreshWorkspace(view) {
        const request = ++view.refreshVersion;
        try {
            const entries = await window.dbUtils.listLibraryDocuments();
            if (!ownsWorkspace(view) || request !== view.refreshVersion) return;
            const sorted = entries.sort(byName);
            const changed = !view.loaded || !sameRows(view.entries, sorted);
            view.loaded = true;
            view.entries = sorted;
            if (view.selected && !view.reference && !entries.some(entry => entry.versionId === view.selected.versionId)) {
                closePreview(view);
                notice(view, '表示していたファイルは更新または削除されました。');
            }
            if (changed) queueSearch(view);
        } catch {
            if (request === view.refreshVersion) notice(view, 'ファイルの一覧を読み取れませんでした。');
        }
    }

    function releasePdf(view) {
        clearTimeout(view.pdfResizeTimer);
        view.pdfRender?.cancel();
        view.pdfRender = null;
        if (view.pdfTask) void view.pdfTask.destroy().catch(() => {});
        view.pdfTask = null;
        view.pdf = null;
        view.pdfLoading = false;
        controls.pdfTools.hidden = true;
        controls.pdfViewport.replaceChildren();
        view.pdfWidth = null;
    }

    function clearPreview(view) {
        view.previewController?.abort();
        releasePdf(view);
        resetDetailSearch(view);
        view.selected = null;
        view.reference = null;
        view.excerpts = [];
        view.extractedReady = false;
        controls.preview.hidden = true;
        controls.layout.dataset.detail = 'false';
        controls.workspace.removeAttribute('data-viewing-file');
        controls.back.title = 'チャットへ戻る';
        controls.back.setAttribute('aria-label', controls.back.title);
        controls.mobileTitle.textContent = '';
        controls.extracts.replaceChildren();
    }

    function renderExtracts(view, targetId) {
        const start = view.page * extractsPerPage;
        const total = view.excerpts.length;
        const fragment = document.createDocumentFragment();
        let target;
        for (const chunk of view.excerpts.slice(start, start + extractsPerPage)) {
            const article = node('article', null, 'document-library-extract');
            article.dataset.chunkId = chunk.id;
            article.append(node('p', window.DocumentSearch.formatLocation(chunk.location), 'document-library-muted'),
                node('pre', chunk.text));
            if (chunk.id === targetId) {
                article.dataset.highlight = 'true';
                article.tabIndex = -1;
                target = article;
            }
            fragment.append(article);
        }
        controls.extracts.replaceChildren(fragment);
        controls.pages.hidden = total <= extractsPerPage;
        controls.previous.disabled = start === 0;
        controls.next.disabled = start + extractsPerPage >= total;
        controls.pageNumber.textContent = total ? (start + 1) + '–' + Math.min(start + extractsPerPage, total) + ' / ' + total : '';
        if (target) {
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: 'nearest' });
        }
    }

    function showChunk(view, chunkId) {
        const order = view.excerpts.findIndex(chunk => chunk.id === chunkId);
        if (order < 0) return false;
        view.page = Math.floor(order / extractsPerPage);
        renderExtracts(view, chunkId);
        return true;
    }

    function isNarrow() {
        return getComputedStyle(controls.mobileTitle).display !== 'none';
    }

    function closePreview(view) {
        if (history.state?.documentLibraryDetail) history.back();
        else returnToCollection(view);
    }

    function markSelected(view) {
        for (const row of controls.list.children) {
            const selected = String(row.dataset.documentId === view.selected?.id && !view.reference);
            row.dataset.selected = selected;
            row.firstElementChild.setAttribute('aria-pressed', selected);
        }
    }

    function setPreviewMode(view, mode) {
        const original = mode === 'original';
        view.previewMode = mode;
        controls.showOriginal.setAttribute('aria-pressed', String(original));
        controls.showExtracts.setAttribute('aria-pressed', String(!original));
        controls.original.hidden = !original;
        controls.extracted.hidden = original;
        if (original) void showPdf(view);
        else view.pdfRender?.cancel();
    }

    async function showPdf(view) {
        if (view.pdfLoading) return;
        if (view.pdf) { void renderPdfPage(view); return; }
        const { selected, reference, previewController: { signal } } = view;
        view.pdfLoading = true;
        controls.originalStatus.textContent = 'PDFを読み込み中…';
        try {
            const original = await window.dbUtils.getLibraryOriginal(selected.id, selected.version, selected.versionId);
            signal.throwIfAborted();
            if (!original?.blob || original.format !== 'pdf' || original.hash !== (reference || selected).hash) {
                throw new Error('原本の版を利用できません。');
            }
            const task = await window.DocumentSearch.openPdf(original.blob, signal);
            if (signal.aborted) { await task.destroy(); return; }
            view.pdfTask = task;
            const pdf = await task.promise;
            signal.throwIfAborted();
            view.pdf = pdf;
            if (view.previewMode === 'original') void renderPdfPage(view);
        } catch (error) {
            if (signal.aborted) return;
            releasePdf(view);
            controls.originalStatus.textContent = error.name === 'PasswordException'
                ? 'パスワード付きのPDFは表示できません。' : 'PDFの原本を表示できませんでした。';
        } finally {
            if (!signal.aborted) view.pdfLoading = false;
        }
    }

    async function renderPdfPage(view, resetScroll = false) {
        const pdf = view.pdf;
        if (!pdf || view.previewMode !== 'original') return;
        const request = view.pdfRequest = (view.pdfRequest ?? 0) + 1;
        const current = () => view.pdf === pdf && view.pdfRequest === request && view.previewMode === 'original';
        const pageNumber = view.pdfPage = Math.min(view.pdfPage, pdf.numPages);
        const zoom = view.pdfZoom;
        view.pdfRender?.cancel();
        controls.pdfTools.hidden = false;
        controls.pdfPrevious.disabled = pageNumber <= 1;
        controls.pdfNext.disabled = pageNumber >= pdf.numPages;
        controls.pdfZoomOut.disabled = zoom <= 0.5;
        controls.pdfZoomIn.disabled = zoom >= 3;
        controls.pdfNumber.textContent = pageNumber + ' / ' + pdf.numPages;
        if (resetScroll) {
            controls.pdfViewport.replaceChildren();
            controls.pdfViewport.scrollLeft = 0;
        }
        try {
            const page = await pdf.getPage(pageNumber);
            if (!current()) return;
            const base = page.getViewport({ scale: 1 });
            const width = Math.max(1, controls.pdfViewport.clientWidth);
            const viewport = page.getViewport({ scale: width / base.width * zoom });
            const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(8000000 / (viewport.width * viewport.height)),
                4096 / Math.max(viewport.width, viewport.height));
            const canvas = node('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
            canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
            canvas.style.width = Math.floor(viewport.width) + 'px';
            canvas.style.height = Math.floor(viewport.height) + 'px';
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', 'PDF ページ ' + pageNumber);
            const task = view.pdfRender = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
            await task.promise;
            if (!current()) return;
            controls.pdfViewport.replaceChildren(canvas);
            controls.originalStatus.textContent = '';
        } catch (error) {
            if (current() && error.name !== 'RenderingCancelledException') {
                controls.pdfViewport.replaceChildren();
                controls.originalStatus.textContent = 'PDFページを表示できませんでした。';
            }
        } finally {
            if (current()) view.pdfRender = null;
        }
    }

    async function preview(view, entry, { chunkId, retry = false, reference = null, fromHistory = false } = {}) {
        if (!ownsWorkspace(view)) return;
        closeMenu();
        if (!view.selected) view.collectionScrollTop = controls.collectionScroll.scrollTop;
        clearPreview(view);
        notice(view, '');
        const controller = view.previewController = new AbortController();
        view.selected = entry;
        view.reference = reference;
        view.page = 0;
        view.pdfPage = 1;
        view.pdfZoom = 1;
        controls.layout.dataset.detail = 'true';
        controls.workspace.dataset.viewingFile = 'true';
        controls.workspace.removeAttribute('data-file-drop');
        controls.preview.hidden = false;
        controls.preview.scrollTop = 0;
        controls.previewTitle.textContent = (entry.fileName || entry.name) + (reference ? ' · 版 ' + entry.version : '');
        controls.mobileTitle.textContent = entry.fileName || entry.name;
        const narrow = isNarrow();
        if (narrow) {
            controls.back.title = 'ライブラリへ戻る';
            controls.back.setAttribute('aria-label', controls.back.title);
        }
        controls.originalStatus.textContent = '';
        controls.showOriginal.disabled = entry.format !== 'pdf';
        controls.previewStatus.textContent = '本文を読み込み中…';
        controls.retry.hidden = true;
        controls.cancel.hidden = Boolean(reference);
        renderExtracts(view);
        markSelected(view);
        if (!reference && !retry && !fromHistory && history.state?.documentLibrary &&
            narrow) {
            const detail = { id: entry.id, versionId: entry.versionId, chunkId };
            if (history.state.documentLibraryDetail) history.replaceState({ ...history.state, documentLibraryDetail: detail }, '', '#chat');
            else history.pushState({ ...history.state, documentLibraryDetail: detail }, '', '#chat');
        }
        if (narrow || reference) (narrow ? controls.title : controls.previewTitle).focus({ preventScroll: true });
        setPreviewMode(view, !controls.showOriginal.disabled && !chunkId && !retry ? 'original' : 'extracted');
        try {
            const result = reference
                ? await window.DocumentSearch.previewReference(reference, { signal: controller.signal })
                : await window.DocumentSearch.previewDocument(entry, { signal: controller.signal, retry });
            if (!ownsWorkspace(view) || controller.signal.aborted) return;
            const ready = result.status === 'ready';
            view.extractedReady = ready;
            controls.previewStatus.textContent = ready ? '' : result.message || '本文を読み取れませんでした。';
            controls.retry.hidden = Boolean(reference) || ready;
            view.excerpts = result.chunks;
            if (!chunkId || !showChunk(view, chunkId)) {
                renderExtracts(view);
                if (ready && chunkId) controls.previewStatus.textContent = '検索した箇所を確認できませんでした。';
            }
            if (!controls.detailFind.hidden && controls.detailQuery.value.trim()) queueDetailSearch(view);
        } catch (error) {
            if (!ownsWorkspace(view) || controller.signal.aborted) return;
            controls.previewStatus.textContent = error.message || '本文を読み取れませんでした。';
            controls.retry.hidden = Boolean(reference);
            if (!controls.detailFind.hidden && controls.detailQuery.value.trim()) queueDetailSearch(view);
        } finally {
            if (ownsWorkspace(view) && !controller.signal.aborted) controls.cancel.hidden = true;
        }
    }

    function queueSearch(view) {
        clearTimeout(view.searchTimer);
        view.searchController?.abort();
        view.matches = null;
        controls.searchStatus.textContent = '';
        const query = controls.query.value.trim();
        view.searchPending = Boolean(query && controls.searchMode.value !== 'name');
        renderCollection(view);
        if (!view.searchPending) return;
        const controller = view.searchController = new AbortController();
        view.searchTimer = setTimeout(async () => {
            try {
                const result = await window.DocumentSearch.findLibraryText(view.entries, query, controller.signal);
                if (!ownsWorkspace(view) || controller.signal.aborted) return;
                view.matches = new Map(result.matches.map(hit => [hit.documentId, hit]));
                if (result.unavailable.length) {
                    controls.searchStatus.textContent = result.unavailable.length + '件のファイルは本文を検索できませんでした。';
                }
            } catch {
                if (ownsWorkspace(view) && !controller.signal.aborted) controls.searchStatus.textContent = 'ファイル検索に失敗しました。';
            } finally {
                if (ownsWorkspace(view) && !controller.signal.aborted) {
                    view.searchPending = false;
                    renderCollection(view);
                }
            }
        }, 160);
    }

    function clearDetailResults(view) {
        clearTimeout(view.detailSearchTimer);
        view.detailSearchController?.abort();
        controls.detailResults.replaceChildren();
        controls.detailResults.hidden = true;
        controls.detailSearchStatus.textContent = '';
    }

    function resetDetailSearch(view) {
        clearDetailResults(view);
        controls.detailFind.hidden = true;
        controls.detailQuery.value = '';
        for (const toggle of [controls.mobileSearch, controls.desktopSearch]) toggle.setAttribute('aria-expanded', 'false');
    }

    function toggleDetailSearch(view, toggle) {
        if (controls.detailFind.hidden) {
            controls.detailFind.hidden = false;
            for (const button of [controls.mobileSearch, controls.desktopSearch]) button.setAttribute('aria-expanded', 'true');
            controls.detailQuery.focus();
        } else {
            resetDetailSearch(view);
            toggle.focus({ preventScroll: true });
        }
    }

    function queueDetailSearch(view) {
        clearDetailResults(view);
        const query = controls.detailQuery.value.trim();
        if (!query) return;
        if (!view.extractedReady) {
            controls.detailSearchStatus.textContent = controls.previewStatus.textContent;
            return;
        }
        const controller = view.detailSearchController = new AbortController();
        view.detailSearchTimer = setTimeout(() => void runDetailSearch(view, query, controller.signal), 160);
    }

    async function runDetailSearch(view, query, signal) {
        try {
            const hits = await window.DocumentSearch.findInChunks([{ id: view.selected.id, chunks: view.excerpts }], query, signal);
            if (!ownsWorkspace(view) || signal.aborted) return;
            const fragment = document.createDocumentFragment();
            for (const hit of hits) {
                const item = node('li');
                const open = button(null, () => {
                    if (!ownsWorkspace(view) || signal.aborted) return;
                    if (view.previewMode === 'original' && hit.location.type === 'pdf') {
                        view.pdfPage = hit.location.page;
                        void renderPdfPage(view, true);
                        controls.pdfViewport.scrollIntoView({ block: 'nearest' });
                    } else showChunk(view, hit.chunkId);
                });
                open.append(node('span', window.DocumentSearch.formatLocation(hit.location), 'document-library-muted'),
                    node('span', hit.excerpt));
                item.append(open);
                fragment.append(item);
            }
            controls.detailResults.replaceChildren(fragment);
            controls.detailResults.hidden = !hits.length;
            controls.detailSearchStatus.textContent = hits.length ? '' : '一致する箇所がありません。';
        } catch {
            if (ownsWorkspace(view) && !signal.aborted) controls.detailSearchStatus.textContent = 'ファイル検索に失敗しました。';
        }
    }

    async function mutate(view, operation) {
        if (!owns(view) || view.mutating) return;
        const inPicker = view.kind === 'picker';
        view.mutating = true;
        if (inPicker) renderPicker(view);
        else setManagementDisabled(true);
        notice(view, '');
        try { await operation(); }
        catch (error) { notice(view, error.message || 'ファイルを更新できませんでした。'); }
        finally {
            view.mutating = false;
            if (owns(view)) {
                if (inPicker) {
                    await refreshPicker(view);
                    if (ownsPicker(view) && !view.mutating) {
                        renderPicker(view);
                        if (!controls.picker.contains(document.activeElement)) controls.pickerTitle.focus({ preventScroll: true });
                    }
                } else {
                    setManagementDisabled(false);
                    await refreshWorkspace(view);
                }
            }
        }
    }

    function setManagementDisabled(disabled) {
        controls.add.disabled = disabled;
        for (const more of controls.list.querySelectorAll('.document-library-more')) more.disabled = disabled;
    }

    function verifyFile(file) {
        if (!formats.has(file.name.split('.').at(-1).toLowerCase()) || !file.name.includes('.')) {
            throw new Error('対応形式は PDF、DOCX、TXT、MD、CSV、TSV、JSON、YAML、XML、HTML です。');
        }
        if (file.size > 128 * 1024 * 1024) throw new Error('画面から登録できるファイルは1件につき128 MiBまでです。');
    }

    function analyzeInBackground(entry) {
        void window.DocumentSearch.analyzeDocument(entry).catch(() => {});
    }

    function addFiles(view, files) {
        return mutate(view, async () => {
            const errors = [];
            const saved = [];
            for (const file of files) {
                try {
                    verifyFile(file);
                    const entry = await window.dbUtils.addLibraryDocument(file);
                    saved.push(entry);
                    analyzeInBackground(entry);
                } catch (error) { errors.push(file.name + ' — ' + (error.message || '保存に失敗しました。')); }
            }
            if (view.kind === 'picker' && saved.length) {
                try { await updateLinks(view, saved, 'add'); }
                catch (error) {
                    errors.push(saved.map(entry => entry.fileName).join('、') +
                        ' — ライブラリに保存済み。チャットに追加できませんでした。' + (error.message || ''));
                }
            }
            notice(view, errors.join('\n'));
        });
    }

    function chooseReplacement(view, entry) {
        view.replaceTarget = entry;
        controls.replacement.click();
    }

    function replaceFile(view, entry, file) {
        return mutate(view, async () => {
            verifyFile(file);
            const next = await window.dbUtils.replaceLibraryDocument(entry.id, file, { expectedVersionId: entry.versionId });
            void window.DocumentSearch.cancelAnalysis(entry).catch(() => {});
            analyzeInBackground(next);
            if (!ownsWorkspace(view)) return;
            if (view.selected?.versionId === entry.versionId && !view.reference) void preview(view, next);
        });
    }

    function deleteDocument(view, entry) {
        return mutate(view, async () => {
            const confirmed = await window.uiUtilsV136.showCustomConfirm(
                '「' + entry.fileName + '」の原本を全版削除し、すべてのチャットから紐づけを解除しますか？',
                { placement: 'chat', confirmLabel: '削除' });
            if (!confirmed || !ownsWorkspace(view)) return;
            await window.dbUtils.deleteLibraryDocument(entry.id, { expectedVersionId: entry.versionId });
            void window.DocumentSearch.cancelAnalysis(entry).catch(() => {});
            if (!ownsWorkspace(view)) return;
            if (view.selected?.id === entry.id) closePreview(view);
        });
    }

    function openWorkspace({ fromHistory = false } = {}) {
        if (window.state.currentScreen !== 'chat') return null;
        const sidebarOverlay = !document.getElementById('chat-sidebar-backdrop').hidden;
        if (workspace) {
            if (sidebarOverlay) {
                window.uiUtilsV136.closeChatSidebar();
                controls.title.focus({ preventScroll: true });
            }
            return workspace;
        }
        closePicker();
        const chat = document.getElementById('chat-workspace');
        const scroller = chat.querySelector('.main-content');
        const activeElement = document.activeElement;
        const returnFocus = chat.contains(activeElement) ? activeElement
            : sidebarOverlay ? document.getElementById('goto-history-btn') : controls.open;
        const view = workspace = { kind: 'workspace', entries: [], refreshVersion: 0, loaded: false, mutating: false,
            chat, scroller, scrollTop: scroller.scrollTop, messages: window.state.currentMessages,
            returnFocus };
        window.appLogic.resetSwipeState();
        window.uiUtilsV136.closeHistoryItemMenu();
        window.settingsUiV136?.closePopover(false);
        if (sidebarOverlay) window.uiUtilsV136.closeChatSidebar();
        if (!fromHistory) history.pushState({ screen: 'chat', documentLibrary: true }, '', '#chat');
        controls.workspace.hidden = false;
        chat.classList.add('document-library-covered');
        window.uiUtilsV136.syncChatWorkspaceInteractivity();
        window.uiUtilsV136.syncChatSidebarCurrentSelection();
        controls.add.disabled = false;
        controls.collectionScroll.scrollTop = 0;
        controls.query.value = '';
        controls.searchMode.value = 'name';
        controls.sort.value = 'name';
        controls.notice.textContent = '';
        clearPreview(view);
        queueSearch(view);
        controls.title.focus({ preventScroll: true });
        void refreshWorkspace(view);
        return view;
    }

    function closeWorkspace({ fromHistory = false, restoreFocus = false } = {}) {
        if (!workspace) return;
        closeMenu();
        const view = workspace;
        workspace = null;
        clearTimeout(view.searchTimer);
        view.searchController?.abort();
        clearPreview(view);
        controls.workspace.removeAttribute('data-file-drop');
        controls.workspace.hidden = true;
        view.chat.classList.remove('document-library-covered');
        window.uiUtilsV136.syncChatWorkspaceInteractivity();
        window.uiUtilsV136.syncChatSidebarCurrentSelection();
        if (!fromHistory && history.state?.documentLibrary) history.replaceState({ screen: 'chat' }, '', '#chat');
        if (view.messages === window.state.currentMessages) {
            view.scroller.scrollTop = view.scrollTop;
            if (restoreFocus) {
                const target = view.returnFocus.getClientRects().length ? view.returnFocus : document.getElementById('goto-history-btn');
                target.focus({ preventScroll: true });
            }
        }
    }

    function back() {
        if (!workspace) return;
        if (history.state?.documentLibraryDetail) history.go(-2);
        else if (history.state?.documentLibrary) history.back();
        else closeWorkspace({ restoreFocus: true });
    }

    function returnToCollection(view) {
        const id = view.selected?.id;
        const narrow = isNarrow();
        clearPreview(view);
        markSelected(view);
        if (narrow) controls.collectionScroll.scrollTop = view.collectionScrollTop ?? 0;
        const row = [...controls.list.children].find(item => item.dataset.documentId === id)?.firstElementChild;
        (row || controls.query).focus({ preventScroll: true });
    }

    async function restoreDetail(view, entry) {
        const detail = entry.documentLibraryDetail;
        try {
            const document = await window.dbUtils.getLibraryDocument(detail.id);
            if (!ownsWorkspace(view) || history.state?.documentLibraryDetail?.versionId !== detail.versionId) return;
            if (document?.versionId === detail.versionId) await preview(view, document, { chunkId: detail.chunkId, fromHistory: true });
            else {
                returnToCollection(view);
                notice(view, '表示していたファイルは更新または削除されました。');
            }
        } catch {
            if (history.state?.documentLibraryDetail?.versionId === detail.versionId) notice(view, 'ファイルを読み取れませんでした。');
        }
    }

    function handleHistory(entry) {
        if (!controls) return;
        if (!entry?.documentLibrary) { closeWorkspace({ fromHistory: true, restoreFocus: true }); return; }
        const view = openWorkspace({ fromHistory: true });
        if (!view) return;
        if (entry.documentLibraryDetail) void restoreDetail(view, entry);
        else if (view.selected) returnToCollection(view);
    }

    async function openReference(value) {
        install();
        const view = openWorkspace();
        if (!view) return;
        const reference = window.DocumentRag.normalize({ schemaVersion: 1, status: 'used', sources: [value] })?.sources[0];
        if (!reference) { notice(view, '参考箇所の記録が無効です。'); return; }
        await preview(view, { id: reference.documentId, fileName: reference.fileName, name: reference.documentName,
            version: reference.version, versionId: reference.versionId, format: reference.format }, { reference, chunkId: reference.chunkId });
    }

    function close() {
        if (!controls) return;
        closePicker();
        closeWorkspace();
    }

    function installFilePicker(input, trigger, currentView, direct = false) {
        let owner;
        trigger.addEventListener('click', () => {
            owner = currentView();
            input.click();
        });
        input.addEventListener('cancel', () => { owner = null; });
        input.addEventListener('change', () => {
            const view = owner || (direct ? currentView() : null);
            const files = [...input.files];
            owner = null;
            input.value = '';
            if (view && files.length) void addFiles(view, files);
        });
    }

    function installDrop() {
        const clear = () => {
            controls.workspace.removeAttribute('data-file-drop');
            controls.picker.removeAttribute('data-file-drop');
        };
        const accept = event => {
            const view = picker || workspace;
            const transfer = event.dataTransfer;
            if (!view || (!transfer?.types.includes('Files') && !transfer?.files.length)) return;
            event.preventDefault();
            event.stopPropagation();
            const surface = picker ? controls.picker : controls.workspace;
            const canDrop = owns(view) && !view.mutating && !surface.inert &&
                !(workspace?.selected && isNarrow()) && surface.contains(event.target);
            if (event.type === 'drop') {
                clear();
                if (canDrop && transfer.files.length) void addFiles(view, [...transfer.files]);
            } else {
                transfer.dropEffect = canDrop ? 'copy' : 'none';
                surface.toggleAttribute('data-file-drop', canDrop);
            }
        };
        for (const type of ['dragenter', 'dragover', 'drop']) document.addEventListener(type, accept, true);
        document.addEventListener('dragleave', event => {
            const surface = picker ? controls.picker : controls.workspace;
            if (!surface.hasAttribute('data-file-drop') || surface.contains(event.relatedTarget)) return;
            if (event.relatedTarget || (event.clientX === 0 && event.clientY === 0)) clear();
        }, true);
        window.addEventListener('dragend', clear, true);
        window.addEventListener('blur', clear);
    }

    function install() {
        if (controls) return;
        const ids = ['open', 'workspace', 'back', 'detail-close', 'title', 'mobile-title', 'mobile-search', 'desktop-search',
            'notice', 'add', 'files', 'replacement', 'sort',
            'collection', 'collection-scroll', 'list', 'empty', 'menu', 'search', 'query', 'search-mode',
            'search-status', 'preview', 'preview-title', 'preview-status', 'detail-search', 'detail-find',
            'detail-query', 'detail-search-status', 'detail-results', 'retry', 'cancel', 'pages', 'previous', 'next',
            'original', 'extracted', 'show-original', 'show-extracts', 'original-status', 'pdf-tools', 'pdf-viewport',
            'pdf-previous', 'pdf-next', 'pdf-number', 'pdf-zoom-in', 'pdf-zoom-out',
            'page-number', 'extracts', 'picker', 'picker-open', 'picker-title', 'picker-heading', 'picker-count', 'picker-back', 'picker-close',
            'picker-notice', 'picker-empty', 'picker-list', 'picker-actions', 'picker-search', 'picker-query',
            'picker-select', 'picker-upload', 'picker-files', 'picker-menu'];
        controls = Object.fromEntries(ids.map(id => [
            id.replace(/-([a-z])/g, (_, char) => char.toUpperCase()), document.getElementById('document-library-' + id)
        ]));
        controls.layout = controls.workspace.querySelector('.document-library-layout');
        for (const placeholder of document.querySelectorAll('[data-document-icon]')) {
            placeholder.replaceWith(icon(placeholder.dataset.documentIcon));
        }
        controls.pickerOpen.addEventListener('click', openPicker);
        controls.pickerClose.addEventListener('click', closePicker);
        controls.picker.addEventListener('close', () => { if (!controls.picker.open) closePicker(); });
        controls.pickerSelect.addEventListener('click', () => pickerSelection(true));
        controls.pickerBack.addEventListener('click', () => pickerSelection(false));
        controls.pickerQuery.addEventListener('input', () => {
            if (picker?.selecting && ownsPicker(picker)) renderPickerRows(picker);
        });
        controls.open.addEventListener('click', () => openWorkspace());
        controls.back.addEventListener('click', () => {
            if (workspace?.selected && isNarrow()) closePreview(workspace);
            else back();
        });
        controls.detailClose.addEventListener('click', () => { if (workspace) closePreview(workspace); });
        installFilePicker(controls.files, controls.add, () => workspace, true);
        installFilePicker(controls.pickerFiles, controls.pickerUpload, () => picker);
        installDrop();
        controls.replacement.addEventListener('change', () => {
            const file = controls.replacement.files[0];
            const entry = workspace?.replaceTarget;
            controls.replacement.value = '';
            if (workspace) workspace.replaceTarget = null;
            if (file && entry) void replaceFile(workspace, entry, file);
        });
        controls.retry.addEventListener('click', () => {
            if (workspace?.selected) void preview(workspace, workspace.selected, { retry: true });
        });
        controls.cancel.addEventListener('click', () => {
            if (workspace?.selected) void window.DocumentSearch.cancelAnalysis(workspace.selected).catch(() => {});
        });
        controls.previous.addEventListener('click', () => { workspace.page--; renderExtracts(workspace); });
        controls.next.addEventListener('click', () => { workspace.page++; renderExtracts(workspace); });
        controls.showOriginal.addEventListener('click', () => setPreviewMode(workspace, 'original'));
        controls.showExtracts.addEventListener('click', () => setPreviewMode(workspace, 'extracted'));
        for (const [button, direction] of [[controls.pdfPrevious, -1], [controls.pdfNext, 1]]) {
            button.addEventListener('click', () => { workspace.pdfPage += direction; void renderPdfPage(workspace, true); });
        }
        for (const [button, step] of [[controls.pdfZoomOut, -0.25], [controls.pdfZoomIn, 0.25]]) {
            button.addEventListener('click', () => { workspace.pdfZoom += step; void renderPdfPage(workspace); });
        }
        for (const toggle of [controls.mobileSearch, controls.desktopSearch]) {
            toggle.addEventListener('click', () => { if (workspace?.selected) toggleDetailSearch(workspace, toggle); });
        }
        controls.query.addEventListener('input', () => { if (workspace) queueSearch(workspace); });
        controls.searchMode.addEventListener('change', () => { if (workspace) queueSearch(workspace); });
        controls.sort.addEventListener('change', () => { if (workspace) renderCollection(workspace); });
        // Native selects can match :focus-visible after a pointer opens the menu.
        for (const select of [controls.searchMode, controls.sort]) {
            const clearPointerFocus = () => select.removeAttribute('data-pointer-focus');
            select.addEventListener('pointerdown', () => select.setAttribute('data-pointer-focus', ''));
            select.addEventListener('keydown', clearPointerFocus);
            select.addEventListener('blur', clearPointerFocus);
        }
        controls.detailQuery.addEventListener('input', () => { if (workspace?.selected) queueDetailSearch(workspace); });
        for (const form of [controls.search, controls.detailSearch]) form.addEventListener('submit', event => event.preventDefault());
        window.addEventListener('focus', () => {
            if (picker) void refreshPicker(picker);
            if (workspace) void refreshWorkspace(workspace);
        });
        document.addEventListener('pointerdown', event => {
            if (rowMenu && !rowMenu.anchor.contains(event.target) && !rowMenu.menu.contains(event.target)) closeMenu();
        }, true);
        document.addEventListener('focusin', event => {
            if (rowMenu && !rowMenu.menu.contains(event.target) && event.target !== rowMenu.anchor) closeMenu();
        });
        document.addEventListener('scroll', event => {
            if (rowMenu && rowMenu.container.contains(event.target)) closeMenu();
        }, { capture: true, passive: true });
        document.addEventListener('keydown', event => {
            if (!rowMenu) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                closeMenu(true);
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                const items = [...rowMenu.menu.children];
                const current = items.indexOf(document.activeElement);
                const delta = event.key === 'ArrowDown' ? 1 : -1;
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : (current + delta + items.length) % items.length;
                event.preventDefault();
                items[next].focus({ preventScroll: true });
            }
        }, true);
        new ResizeObserver(() => {
            if (rowMenu) window.uiUtilsV136.positionRowMenu(rowMenu.menu, rowMenu.anchor, rowMenu.container);
            const label = workspace?.selected && isNarrow() ? 'ライブラリへ戻る' : 'チャットへ戻る';
            controls.back.title = label;
            controls.back.setAttribute('aria-label', label);
        }).observe(controls.workspace);
        new ResizeObserver(([entry]) => {
            const view = workspace;
            if (!view?.pdf || view.previewMode !== 'original' || entry.contentRect.width <= 0 ||
                entry.contentRect.width === view.pdfWidth) return;
            view.pdfWidth = entry.contentRect.width;
            clearTimeout(view.pdfResizeTimer);
            view.pdfResizeTimer = setTimeout(() => void renderPdfPage(view), 110);
        }).observe(controls.pdfViewport);
    }

    return { install, close, handleHistory, openReference };
})();
