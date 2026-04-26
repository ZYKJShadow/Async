import * as electron from 'electron';

type ElectronNetLike = {
	fetch?: (input: string | Request, init?: RequestInit) => Promise<Response>;
};

export async function electronNetFetch(input: string | Request, init?: RequestInit): Promise<Response> {
	const net = (electron as { net?: ElectronNetLike }).net;
	const fetchWithChromium = net?.fetch;
	if (typeof fetchWithChromium === 'function') {
		return await fetchWithChromium.call(net, input, init);
	}
	return await fetch(input, init);
}
