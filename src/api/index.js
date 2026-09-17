import { createClient } from "./client";
import models from "./models";
import intents from "./intents";
import entities from "./entities";
import values from "./values";
import slots from "./slots";
import utterances from "./utterances";
import tags from "./tags";
import dataset from "./dataset";
import trainings from "./trainings";
import instances from "./instances";
import analytics from "./analytics";
import users from "./users";

// Assemble the resource namespaces over one authenticated client. Adding an
// endpoint means editing the resource module it belongs to and nothing else.
// `subscribe` (from ApiContext) lets the client wait on long-running requests
// over Socket.IO instead of polling; see client.js.
const createApi = (token, onUnauthorized, subscribe) => {
    const client = createClient(token, onUnauthorized, subscribe);
    return {
        models: models(client),
        intents: intents(client),
        entities: entities(client),
        values: values(client),
        slots: slots(client),
        utterances: utterances(client),
        tags: tags(client),
        dataset: dataset(client),
        trainings: trainings(client),
        instances: instances(client),
        analytics: analytics(client),
        users: users(client),
    };
};

export default createApi;
