export type KeyName = string;
export type Keystroke = string;

export type KeyEventData = {
	ctrlKey?: boolean;
	metaKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	key: string;
	code: string;
	eventName: string;
	time: number;
	registrationTime: number;
};

const REGEX_LATIN_KEYNAME = /^[A-Za-z]$/;

export function getKeyName(event: KeyEventData, metaKeyName: string, altKeyName: string): KeyName {
	let key: string;
	if (event.key === 'Control') {
		key = 'Ctrl';
	} else if (event.key === 'Meta') {
		key = metaKeyName;
	} else if (event.key === 'Alt') {
		key = altKeyName;
	} else if (event.key === 'Shift') {
		key = 'Shift';
	} else if (event.key === '`') {
		key = '`';
	} else if (event.key === '~') {
		key = '~';
	} else {
		key = event.code;
		if (REGEX_LATIN_KEYNAME.test(event.key)) {
			key = event.key.toUpperCase();
		} else {
			key = key.replace('Key', '');
			key = key.replace('Arrow', '');
			key = key.replace('Digit', '');
			key =
				(
					{
						Comma: ',',
						Period: '.',
						Slash: '/',
						Backslash: '\\',
						IntlBackslash: '`',
						Minus: '-',
						Equal: '=',
						Semicolon: ';',
						Quote: "'",
						BracketLeft: '[',
						BracketRight: ']',
					} as Record<string, string>
				)[key] ?? key;
		}
	}
	return key;
}

export function getKeystrokeName(keys: KeyName[], metaKeyName: string, altKeyName: string): Keystroke {
	const strictOrdering: KeyName[] = ['Ctrl', metaKeyName, altKeyName, 'Shift'];
	const ordered = [
		...(strictOrdering.map((x) => keys.find((k) => k === x)).filter(Boolean) as KeyName[]),
		...keys.filter((k) => !strictOrdering.includes(k)),
	];
	return ordered.join('-');
}
