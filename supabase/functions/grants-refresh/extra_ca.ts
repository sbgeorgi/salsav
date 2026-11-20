// Hosts whose server sends its leaf certificate without the intermediate (openssl verify code 21), so a plain fetch
// fails with "unable to verify the first certificate". Their requests go through a client that also trusts the missing
// intermediate; every other host uses the plain fetch unchanged. Pure module (no Deno globals): index.ts and the Node
// harness pass their own client factory.

// GlobalSign RSA OV SSL CA 2018 (issuer GlobalSign Root CA - R3, valid to 2028-11-21, sha256 B6:76:FF:A3:...:93:76:4A),
// fetched 2026-11-20 from the leaf's AIA caIssuers URL http://secure.globalsign.com/cacert/gsrsaovsslca2018.crt.
export const GLOBALSIGN_RSA_OV_SSL_CA_2018 = `-----BEGIN CERTIFICATE-----
MIIETjCCAzagAwIBAgINAe5fIh38YjvUMzqFVzANBgkqhkiG9w0BAQsFADBMMSAw
HgYDVQQLExdHbG9iYWxTaWduIFJvb3QgQ0EgLSBSMzETMBEGA1UEChMKR2xvYmFs
U2lnbjETMBEGA1UEAxMKR2xvYmFsU2lnbjAeFw0xODExMjEwMDAwMDBaFw0yODEx
MjEwMDAwMDBaMFAxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9iYWxTaWduIG52
LXNhMSYwJAYDVQQDEx1HbG9iYWxTaWduIFJTQSBPViBTU0wgQ0EgMjAxODCCASIw
DQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKdaydUMGCEAI9WXD+uu3Vxoa2uP
UGATeoHLl+6OimGUSyZ59gSnKvuk2la77qCk8HuKf1UfR5NhDW5xUTolJAgvjOH3
idaSz6+zpz8w7bXfIa7+9UQX/dhj2S/TgVprX9NHsKzyqzskeU8fxy7quRU6fBhM
abO1IFkJXinDY+YuRluqlJBJDrnw9UqhCS98NE3QvADFBlV5Bs6i0BDxSEPouVq1
lVW9MdIbPYa+oewNEtssmSStR8JvA+Z6cLVwzM0nLKWMjsIYPJLJLnNvBhBWk0Cq
o8VS++XFBdZpaFwGue5RieGKDkFNm5KQConpFmvv73W+eka440eKHRwup08CAwEA
AaOCASkwggElMA4GA1UdDwEB/wQEAwIBhjASBgNVHRMBAf8ECDAGAQH/AgEAMB0G
A1UdDgQWBBT473/yzXhnqN5vjySNiPGHAwKz6zAfBgNVHSMEGDAWgBSP8Et/qC5F
JK5NUPpjmove4t0bvDA+BggrBgEFBQcBAQQyMDAwLgYIKwYBBQUHMAGGImh0dHA6
Ly9vY3NwMi5nbG9iYWxzaWduLmNvbS9yb290cjMwNgYDVR0fBC8wLTAroCmgJ4Yl
aHR0cDovL2NybC5nbG9iYWxzaWduLmNvbS9yb290LXIzLmNybDBHBgNVHSAEQDA+
MDwGBFUdIAAwNDAyBggrBgEFBQcCARYmaHR0cHM6Ly93d3cuZ2xvYmFsc2lnbi5j
b20vcmVwb3NpdG9yeS8wDQYJKoZIhvcNAQELBQADggEBAJmQyC1fQorUC2bbmANz
EdSIhlIoU4r7rd/9c446ZwTbw1MUcBQJfMPg+NccmBqixD7b6QDjynCy8SIwIVbb
0615XoFYC20UgDX1b10d65pHBf9ZjQCxQNqQmJYaumxtf4z1s4DfjGRzNpZ5eWl0
6r/4ngGPoJVpjemEuunl1Ig423g7mNA2eymw0lIYkN5SQwCuaifIFJ6GlazhgDEw
fpolu4usBCOmmQDo8dIm7A9+O4orkjgTHY+GzYZSR+Y0fFukAj6KYXwidlNalFMz
hriSqHKvoflShx8xpfywgVcvzfTO3PYkz6fiNJBonf6q8amaEsybwMbDqKWwIX7e
SPY=
-----END CERTIFICATE-----
`;

// Hostname -> PEM of the intermediate that host omits. UAE National Center of Meteorology (funder 3745dceb, UAEREP):
// one leaf (CN www.rain.ae) serves all of these.
export const EXTRA_CA: Record<string, string> = {
  "www.uaerep.ae": GLOBALSIGN_RSA_OV_SSL_CA_2018,
  "uaerep.ae": GLOBALSIGN_RSA_OV_SSL_CA_2018,
  "apply.uaerep.ae": GLOBALSIGN_RSA_OV_SSL_CA_2018,
  "www.rain.ae": GLOBALSIGN_RSA_OV_SSL_CA_2018,
  "rain.ae": GLOBALSIGN_RSA_OV_SSL_CA_2018,
};

/** Wraps fetch so hosts in `map` get the extra init fields `extraInit(pem)` returns (Deno: {client}, Node: {dispatcher}).
 *  A factory that throws (runtime without that API) falls back to the plain fetch, which fails as it did before. */
export function withExtraCa(base: typeof fetch, extraInit: (pem: string) => Record<string, unknown>, map: Record<string, string> = EXTRA_CA): typeof fetch {
  const made = new Map<string, Record<string, unknown> | null>(); // per PEM, created on first use
  return (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const pem = map[new URL(href).hostname];
    if (!pem) return base(input, init);
    if (!made.has(pem)) {
      try {
        made.set(pem, extraInit(pem));
      } catch {
        made.set(pem, null);
      }
    }
    const extra = made.get(pem);
    return extra ? base(input, { ...init, ...extra } as RequestInit) : base(input, init);
  };
}
