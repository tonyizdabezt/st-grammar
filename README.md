# Grammar

A SillyTavern extension for non-native English speakers. It proofreads each message you send and shows the corrections under it, so you pick up your mistakes while you roleplay.

## How it works

- Your reply isn't delayed: the check runs in the background.
- The spell-check icon in a message's three-dots menu checks that message on demand.
- Corrections never go into your message, so the AI doesn't see them.
- Only your message is sent to the model, not the chat history. Dialogue in double quotes is left out too, unless **Improve dialogues** is on.
- Results are saved with the chat. Editing a message removes its old result and, with **Run automatically** on, checks it again.
- Slang, a character's voice, deliberate fragments and `*action*` formatting are left alone.
- Messages that aren't in English, or are shorter than **Min words**, are skipped.

## Installation

1. Open **Extensions** → **Install extension**
2. Paste `https://github.com/tonyizdabezt/st-grammar`
3. Reload SillyTavern

## Settings

Under **Extensions** → **Grammar**:

- **Run automatically**: checks each message when you send or edit it. Default: on.
- **Connection profile**: the profile to check with. Requires the Connection Manager extension.
- **Model**: overrides the profile's model. Leave empty to use the profile's own.
- **Dialect**: All accepts both American and British English. US or UK flags the other one's spelling and word choice. Default: All.
- **Min words**: shorter messages aren't checked automatically. Dialogue doesn't count while **Improve dialogues** is off. Default: 2.
- **Improve dialogues**: fixes your character's dialogue and makes it sound natural and native. When off, nothing in double quotes is sent or changed. Default: off.
- **Show why**: the short reason after each fix. Default: on.

## Tests

`node --test`

## License

MIT
