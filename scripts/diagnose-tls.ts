import net from "node:net";
import tls from "node:tls";

/**
 * Diagnóstico de TLS contra el pooler de Supabase.
 *
 * PostgreSQL no habla TLS desde el primer byte: primero se envía un paquete
 * SSLRequest y el servidor responde 'S' antes de negociar. Por eso un cliente
 * TLS normal no sirve para inspeccionar este certificado.
 */

const [, , hostArg, portArg] = process.argv;
const host = hostArg ?? "aws-1-us-east-1.pooler.supabase.com";
const port = Number(portArg ?? 6543);

const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]);

const socket = net.connect({ host, port }, () => socket.write(SSL_REQUEST));

socket.once("data", (response) => {
  if (response.toString() !== "S") {
    console.error(`El servidor rechazó TLS (respondió ${response.toString()})`);
    process.exit(1);
  }

  const secure = tls.connect(
    { socket, servername: host, rejectUnauthorized: false },
    () => {
      let cert = secure.getPeerCertificate(true);
      const chain: string[] = [];
      const seen = new Set<string>();

      while (cert && Object.keys(cert).length > 0 && !seen.has(cert.fingerprint256)) {
        seen.add(cert.fingerprint256);
        chain.push(
          `  subject: ${JSON.stringify(cert.subject)}\n  issuer:  ${JSON.stringify(cert.issuer)}`,
        );
        if (cert.issuerCertificate === cert) break;
        cert = cert.issuerCertificate;
      }

      console.log(`host: ${host}:${port}`);
      console.log(`autorizado por el almacén del sistema: ${secure.authorized}`);
      if (!secure.authorized) console.log(`motivo: ${secure.authorizationError}`);
      console.log(`\ncadena de ${chain.length} certificado(s):`);
      console.log(chain.join("\n  ---\n"));
      secure.end();
      process.exit(0);
    },
  );

  secure.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
});

socket.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
