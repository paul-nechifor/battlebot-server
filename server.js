// https://ws4py.readthedocs.io/en/latest/sources/managertutorial/
// https://stackoverflow.com/questions/3142705/is-there-a-websocket-client-implemented-for-python
// https://ws4py.readthedocs.io/en/latest/sources/ws4py/

const Rx = require('rxjs');
const WebSocket = require('ws');

var authenticate = require('./authenticate');


function createWebsocketSubject(ws) {
  // Wraps the WebSocket in/out streams with an RxJS Subject. The subject acts
  // as an Observer on outgoing messages and an Observable for incoming
  // messages.
  const observer = {
    next: (x) => ws.send(x),
    error: (err) => {
      console.error(err);
      ws.close(1002, 'ERROR')
    },
    complete: () => ws.close(),
  };

  const observable = Rx.Observable.create(obs => {
    ws.on('message', (data) => obs.next(data));
    ws.on('error', (err) => obs.error(err));
    ws.on('close', () => obs.complete());

    return () => obs.complete();
  }).share();

  return Rx.Subject.create(observer, observable);
}

function createWebsocketStream(opts = { port: 8080 }) {
  // A stream of WebSocket subjects.
  return Rx.Observable.create(observer => {
    console.log(`Opening a server on port ${opts.port}`);
    const wss = new WebSocket.Server(opts);

    wss.on('connection', (ws) => {
      observer.next(createWebsocketSubject(ws));
    });

    return () => wss.close(err => {
      if (err) console.error(err);
      console.log('Server Closed');
    });
  }).share();
}

function createAuthenticatedServer(transform, opts) {
  const authedSockets$ = createWebsocketStream(opts)
    .let(authenticate());

  const incoming$ = authedSockets$.flatMap(
    ({ ws, id }) => ws.map(
      msg => ({ from: id, data: JSON.parse(msg) })
    )
  );

  // Process incoming messages to outgoing messages with the operator
  // transform.
  const outgoing$ = incoming$
    .let(transform)
    .publish();
  outgoing$.connect();

  // Send outgoing messages to the appropriate socket.
  authedSockets$.subscribe(({ ws, id }) => {
    const subscription = outgoing$
      .filter(({ to }) => to === id)
      .map(({ data }) => JSON.stringify(data))
      .subscribe(ws);

    // Handle cleanup of the subscriptions when the socket is closed by the
    // client (or server).
    ws.subscribe({
      complete: () => subscription.unsubscribe(),
      err: () => subscription.unsubscribe(),
    });
  });
}

createAuthenticatedServer(incoming$ => (
  incoming$
    .delay(1000)
    .combineLatest(
      Rx.Observable.of(1,2,3),
      ({ from: id, data: { number } }, x) => (
        { to: id, data: { number: x + number }}
      )
    )
));

module.exports = { createAuthenticatedServer };