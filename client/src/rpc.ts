import { Context, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { RpcClient, type RpcClientError, RpcSerialization } from 'effect/rpc';
import { CoilRpcs, RPC_PATH } from '../../shared/protocol';

type CoilRpcClient = RpcClient.FromGroup<typeof CoilRpcs, RpcClientError.RpcClientError>;

export class CoilClient extends Context.Service<CoilClient, CoilRpcClient>()('coil/CoilClient') {}

const protocol = RpcClient.layerProtocolHttp({ url: RPC_PATH }).pipe(
  Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
);

export const CoilClientLive = Layer.effect(CoilClient, RpcClient.make(CoilRpcs)).pipe(
  Layer.provide(protocol),
);
