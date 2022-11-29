// @flow

import React, { Component } from "react";
import GraphiQL from "graphiql";
import GraphiQLExplorer from "graphiql-explorer";
import { buildClientSchema, getIntrospectionQuery, parse, getOperationAST } from "graphql";
import { createClient } from "graphql-ws";
import { makeDefaultArg, getDefaultScalarArgValue } from "./CustomArgs";

import "graphiql/graphiql.css";
import "./App.css";

import { FetcherParams, FetcherReturnType } from "graphiql/dist/components/GraphiQL";

const queryUrl = "https://tokenql-256gb.hasura.app/v1/graphql";
const subscriptionsClient = createClient({ url: "wss://api.tokenql-256gb.com/v1/graphql" });

function isSubscription({ query, operationName }: FetcherParams) {
  const node = parse(query);
  const operation = getOperationAST(node, operationName);
  return operation && operation.operation === "subscription";
}

function getSinkFromArgs(args: unknown[]) {
  if (typeof args[0] === "object") {
    return args[0];
  }
  return {
    next: args[0],
    complete: args[1],
    error: args[2],
  };
}

// plug me in the `fetcher` prop on the GraphiQL component
export function fetcher(params) {
  // https://github.com/enisdenjo/graphql-ws/issues/93#issuecomment-758625106
  if (isSubscription(params)) {
    return {
      subscribe: (...args) => {
        const sink = getSinkFromArgs(args);
        const unsubscribe = subscriptionsClient.subscribe(params, {
          next: sink.next,
          complete: sink.complete,
          // Display nice, textual, meaningful errors.
          error: (err) => {
            if (err instanceof Error) {
              sink.error(err);
            } else if (err instanceof CloseEvent) {
              sink.error(
                new Error(
                  `Socket closed with event ${err.code}` + err.reason
                    ? `: ${err.reason}` // reason will be available on clean closes
                    : ""
                )
              );
            } else {
              sink.error(new Error(err.map(({ message }) => message).join(", ")));
            }
          },
        });
        return { unsubscribe };
      },
    };
  } else {
    return fetch(queryUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    })
      .then(function(response) {
        return response.text();
      })
      .then(function(responseBody) {
        try {
          return JSON.parse(responseBody);
        } catch (e) {
          return responseBody;
        }
      });
  }
}

const DEFAULT_QUERY = `
query MyQuery {
  Ethereum_Mainnet_ERC721(limit: 10) {
    address
    balance
    contract
    id
    name
    symbol
    tokenId
    tokenURI
  }
}
`;

type State = {
  schema: ?GraphQLSchema,
  query: string,
  explorerIsOpen: boolean,
};

class App extends Component<{}, State> {
  _graphiql: GraphiQL;
  state = { schema: null, query: DEFAULT_QUERY, explorerIsOpen: true };

  componentDidMount() {
    fetcher({
      query: getIntrospectionQuery(),
    }).then((result) => {
      const editor = this._graphiql.getQueryEditor();
      editor.setOption("extraKeys", {
        ...(editor.options.extraKeys || {}),
        "Shift-Alt-LeftClick": this._handleInspectOperation,
      });

      this.setState({ schema: buildClientSchema(result.data) });
    });
  }

  _handleInspectOperation = (cm: any, mousePos: { line: Number, ch: Number }) => {
    const parsedQuery = parse(this.state.query || "");

    if (!parsedQuery) {
      console.error("Couldn't parse query document");
      return null;
    }

    var token = cm.getTokenAt(mousePos);
    var start = { line: mousePos.line, ch: token.start };
    var end = { line: mousePos.line, ch: token.end };
    var relevantMousePos = {
      start: cm.indexFromPos(start),
      end: cm.indexFromPos(end),
    };

    var position = relevantMousePos;

    var def = parsedQuery.definitions.find((definition) => {
      if (!definition.loc) {
        console.log("Missing location information for definition");
        return false;
      }

      const { start, end } = definition.loc;
      return start <= position.start && end >= position.end;
    });

    if (!def) {
      console.error("Unable to find definition corresponding to mouse position");
      return null;
    }

    var operationKind = def.kind === "OperationDefinition" ? def.operation : def.kind === "FragmentDefinition" ? "fragment" : "unknown";

    var operationName = def.kind === "OperationDefinition" && !!def.name ? def.name.value : def.kind === "FragmentDefinition" && !!def.name ? def.name.value : "unknown";

    var selector = `.graphiql-explorer-root #${operationKind}-${operationName}`;

    var el = document.querySelector(selector);
    el && el.scrollIntoView();
  };

  _handleEditQuery = (query: string): void => this.setState({ query });

  _handleToggleExplorer = () => {
    this.setState({ explorerIsOpen: !this.state.explorerIsOpen });
  };

  render() {
    const { query, schema } = this.state;
    return (
      <div className="graphiql-container">
        <GraphiQLExplorer schema={schema} query={query} onEdit={this._handleEditQuery} onRunOperation={(operationName) => this._graphiql.handleRunQuery(operationName)} explorerIsOpen={this.state.explorerIsOpen} onToggleExplorer={this._handleToggleExplorer} getDefaultScalarArgValue={getDefaultScalarArgValue} makeDefaultArg={makeDefaultArg} />
        <GraphiQL theme={'dark'} ref={(ref) => (this._graphiql = ref)} fetcher={fetcher} schema={schema} query={query} onEditQuery={this._handleEditQuery}>
          <GraphiQL.Toolbar>
            <GraphiQL.Button onClick={() => this._graphiql.handlePrettifyQuery()} label="Prettify" title="Prettify Query (Shift-Ctrl-P)" />
            <GraphiQL.Button onClick={() => this._graphiql.handleToggleHistory()} label="History" title="Show History" />
            <GraphiQL.Button onClick={this._handleToggleExplorer} label="Explorer" title="Toggle Explorer" />
          </GraphiQL.Toolbar>
        </GraphiQL>
      </div>
    );
  }
}

export default App;
