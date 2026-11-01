import { secret_state, SECRET_KEYS } from '../../../secrets.js';
import { applyFixes, buildPrompt, hideDialogues, parseCheck, worthChecking } from './check.js';

const MODULE = 'grammar';
const MAX_TOKENS = 4096;
const DEFAULTS = { autoCheck: true, profileId: '', model: '', dialect: 'all', minWords: 2, improveDialogues: false, showWhy: true };

const ctx = () => SillyTavern.getContext();
const checking = new WeakMap();
let settings;

function loadSettings() {
    const all = ctx().extensionSettings;
    all[MODULE] = Object.assign(structuredClone(DEFAULTS), all[MODULE]);
    settings = all[MODULE];
}

// hack: profiles don't store vertexai_auth_mode, so infer it from which secret list holds the key
function getProviderOverrides(profile) {
    if (profile?.api !== 'vertexai') return {};
    const oai = ctx().chatCompletionSettings;
    const secretId = profile['secret-id'];
    const has = key => secretId && secret_state[key]?.some(s => s.id === secretId);
    const mode = has(SECRET_KEYS.VERTEXAI_SERVICE_ACCOUNT) ? 'full'
        : has(SECRET_KEYS.VERTEXAI) ? 'express'
            : oai.vertexai_auth_mode;
    return {
        vertexai_auth_mode: mode,
        vertexai_express_project_id: oai.vertexai_express_project_id,
    };
}

async function request(text) {
    const svc = ctx().ConnectionManagerRequestService;
    const overrides = getProviderOverrides(svc.getProfile(settings.profileId));
    if (settings.model.trim()) overrides.model = settings.model.trim();
    const prompt = svc.constructPrompt([
        { role: 'system', content: buildPrompt(settings) },
        { role: 'user', content: text },
    ], settings.profileId);
    const result = await svc.sendRequest(settings.profileId, prompt, MAX_TOKENS, {}, overrides);
    return result?.content;
}

function renderFix({ from, to, why, applied }) {
    const row = $('<div class="grammar_fix">').append(
        applied ? '<span class="grammar_clean" aria-hidden="true">✓</span> ' : '<span class="grammar_mark" aria-hidden="true">✗</span> ',
        $('<s class="grammar_from">').text(from),
        ' → ',
        $('<b class="grammar_to">').text(to),
    );
    if (why && settings.showWhy) row.append($('<span class="grammar_why">').text(` · ${why}`));
    return row;
}

function renderResult(result) {
    if (!result || result.skipped) return null;
    if (!result.fixes.length && !result.natural) {
        return $('<div class="grammar_block grammar_clean" title="No mistakes found" aria-label="No mistakes found">✓</div>');
    }
    const block = $('<div class="grammar_block">').append(result.fixes.map(renderFix));
    if (result.natural) block.append($('<div class="grammar_natural">').text(`Natural: ${result.natural}`));
    if (result.fixes.length && !result.fixes.some(fix => fix.applied)) block.append('<button type="button" class="grammar_apply">Apply fixes</button>');
    return block;
}

function draw(message, status, error) {
    const mes = $(`#chat .mes[mesid="${ctx().chat.indexOf(message)}"]`);
    mes.find('.grammar_block').remove();
    let block;
    if (status === 'pending') {
        block = $('<div class="grammar_block grammar_pending"><i class="fa-solid fa-spinner fa-spin"></i> Checking grammar</div>');
    } else if (status === 'failed') {
        block = $('<button type="button" class="grammar_block grammar_failed">Grammar check failed. Click to retry.</button>')
            .attr('title', error.cause?.message ?? error.message)
            .on('click', () => { check(message, true); });
    } else {
        block = renderResult(message.extra?.grammar);
    }
    // beside .mes_text, not inside it: SillyTavern rewrites .mes_text on every edit
    if (block) mes.find('.mes_text').after(block);
}

const drawAll = () => ctx().chat.filter(message => message.extra?.grammar).forEach(message => draw(message));

async function check(message, manual = false) {
    if (!message?.is_user || message.is_system) return;
    const text = message.mes;
    const current = message.extra?.grammar?.text === text;
    if (checking.get(message) === text || (current && !manual)) return;

    if (!current && message.extra) delete message.extra.grammar;
    draw(message);
    const source = settings.improveDialogues ? text : hideDialogues(text);
    if (manual && !settings.profileId) {
        toastr.warning('Pick a connection profile in the Grammar settings first.', 'Grammar');
        return;
    }
    if (manual && !worthChecking(source, 1)) {
        toastr.info('Nothing to check: the message is too long, or it\'s all dialogue and Improve dialogues is off.', 'Grammar');
        return;
    }
    if (!manual && (!settings.autoCheck || !settings.profileId || !worthChecking(source, settings.minWords))) return;

    checking.set(message, text);
    draw(message, 'pending');
    try {
        const result = parseCheck(await request(source), text, source);
        if (message.mes !== text || !ctx().chat.includes(message)) return;
        message.extra ??= {};
        message.extra.grammar = result;
        draw(message);
        ctx().saveChat();
        if (manual && result.skipped) toastr.info('This message isn\'t in English, so it wasn\'t checked.', 'Grammar');
    } catch (err) {
        console.warn('[Grammar] check failed', err);
        if (message.mes === text) draw(message, 'failed', err);
    } finally {
        if (checking.get(message) === text) checking.delete(message);
    }
}

function apply(message) {
    const result = message?.extra?.grammar;
    if (!result?.fixes || message.mes !== result.text) return;
    const id = ctx().chat.indexOf(message);
    // redrawing .mes_text would wipe out an open edit box
    if ($(`#chat .mes[mesid="${id}"] .edit_textarea`).length) {
        toastr.info('Finish editing the message first.', 'Grammar');
        return;
    }
    const { text, fixes } = applyFixes(result.text, result.fixes, !settings.improveDialogues);
    const skipped = fixes.filter(fix => !fix.applied).length;
    if (skipped) toastr.warning(`Not applied: ${skipped}. Their words appear more than once, overlap another fix, or are in dialogue.`, 'Grammar');
    if (text === message.mes) return;
    message.mes = text;
    result.text = text;
    result.fixes = fixes;
    ctx().updateMessageBlock(id, message);
    draw(message);
    ctx().saveChat();
    ctx().eventSource.emit(ctx().eventTypes.MESSAGE_UPDATED, id);
}

function createSettingsUI() {
    $('#extensions_settings').append(`
        <div class="grammar_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Grammar</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label"><input id="grammar_auto_check" type="checkbox"> Run automatically</label>
                    <small>Checks each message when you send or edit it. The spell-check icon in a message's three-dots menu always works.</small>
                    <label for="grammar_profile">Connection profile</label>
                    <select id="grammar_profile" class="text_pole"></select>
                    <label for="grammar_model">Model</label>
                    <input id="grammar_model" type="text" class="text_pole" placeholder="Profile's model" autocomplete="off">
                    <small>A small, fast model is recommended. Leave empty to use the profile's own model.</small>
                    <label for="grammar_dialect">Dialect</label>
                    <select id="grammar_dialect" class="text_pole">
                        <option value="all">All</option>
                        <option value="us">US</option>
                        <option value="uk">UK</option>
                    </select>
                    <label for="grammar_min_words">Min words</label>
                    <input id="grammar_min_words" type="number" min="1" step="1" class="text_pole">
                    <small>Shorter messages aren't checked automatically.</small>
                    <label class="checkbox_label"><input id="grammar_improve_dialogues" type="checkbox"> Improve dialogues</label>
                    <small>Fixes your character's dialogue and makes it sound natural and native. When off, nothing in double quotes is checked.</small>
                    <label class="checkbox_label"><input id="grammar_show_why" type="checkbox"> Show why</label>
                    <small>The short reason after each fix.</small>
                </div>
            </div>
        </div>`);

    $('#grammar_auto_check').prop('checked', settings.autoCheck).on('input', function () {
        settings.autoCheck = this.checked;
        ctx().saveSettingsDebounced();
    });
    $('#grammar_model').val(settings.model).on('input', function () {
        settings.model = this.value;
        ctx().saveSettingsDebounced();
    });
    $('#grammar_dialect').val(settings.dialect).on('input', function () {
        settings.dialect = this.value;
        ctx().saveSettingsDebounced();
    });
    $('#grammar_min_words').val(settings.minWords).on('change', function () {
        settings.minWords = Math.max(1, Math.floor(Number(this.value)) || DEFAULTS.minWords);
        this.value = settings.minWords;
        ctx().saveSettingsDebounced();
    });
    $('#grammar_improve_dialogues').prop('checked', settings.improveDialogues).on('input', function () {
        settings.improveDialogues = this.checked;
        ctx().saveSettingsDebounced();
    });
    $('#grammar_show_why').prop('checked', settings.showWhy).on('input', function () {
        settings.showWhy = this.checked;
        ctx().saveSettingsDebounced();
        drawAll();
    });

    try {
        ctx().ConnectionManagerRequestService.handleDropdown('#grammar_profile', settings.profileId, (profile) => {
            settings.profileId = profile?.id ?? '';
            ctx().saveSettingsDebounced();
        });
    } catch (err) {
        $('#grammar_profile').replaceWith('<small>Enable the Connection Manager extension to pick a profile.</small>');
    }
}

jQuery(() => {
    loadSettings();
    createSettingsUI();

    $('#message_template .mes_buttons .extraMesButtons').prepend('<div title="Check grammar" class="mes_button grammar_check fa-solid fa-spell-check"></div>');
    $('#chat').on('click', '.grammar_check', function () {
        check(ctx().chat[Number($(this).closest('.mes').attr('mesid'))], true);
    });
    $('#chat').on('click', '.grammar_apply', function () {
        apply(ctx().chat[Number($(this).closest('.mes').attr('mesid'))]);
    });

    const { eventSource, eventTypes } = ctx();
    // the braces matter: returning the promise would make SillyTavern wait before generating
    const onMessage = (id) => { check(ctx().chat[id]); };
    eventSource.on(eventTypes.USER_MESSAGE_RENDERED, onMessage);
    eventSource.on(eventTypes.MESSAGE_UPDATED, onMessage);
    eventSource.on(eventTypes.CHAT_CHANGED, drawAll);
    eventSource.on(eventTypes.MORE_MESSAGES_LOADED, drawAll);
});
