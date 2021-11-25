# Generated by the gRPC Python protocol compiler plugin. DO NOT EDIT!
"""Client and server classes corresponding to protobuf-defined services."""
import grpc

from . import miner_pb2 as miner__pb2


class MinerStub(object):
    """Missing associated documentation comment in .proto file."""

    def __init__(self, channel):
        """Constructor.

        Args:
            channel: A grpc.Channel.
        """
        self.Mine = channel.unary_unary(
                '/bc.miner.Miner/Mine',
                request_serializer=miner__pb2.MinerRequest.SerializeToString,
                response_deserializer=miner__pb2.MinerResponse.FromString,
                )


class MinerServicer(object):
    """Missing associated documentation comment in .proto file."""

    def Mine(self, request, context):
        """Missing associated documentation comment in .proto file."""
        context.set_code(grpc.StatusCode.UNIMPLEMENTED)
        context.set_details('Method not implemented!')
        raise NotImplementedError('Method not implemented!')


def add_MinerServicer_to_server(servicer, server):
    rpc_method_handlers = {
            'Mine': grpc.unary_unary_rpc_method_handler(
                    servicer.Mine,
                    request_deserializer=miner__pb2.MinerRequest.FromString,
                    response_serializer=miner__pb2.MinerResponse.SerializeToString,
            ),
    }
    generic_handler = grpc.method_handlers_generic_handler(
            'bc.miner.Miner', rpc_method_handlers)
    server.add_generic_rpc_handlers((generic_handler,))


 # This class is part of an EXPERIMENTAL API.
class Miner(object):
    """Missing associated documentation comment in .proto file."""

    @staticmethod
    def Mine(request,
            target,
            options=(),
            channel_credentials=None,
            call_credentials=None,
            insecure=False,
            compression=None,
            wait_for_ready=None,
            timeout=None,
            metadata=None):
        return grpc.experimental.unary_unary(request, target, '/bc.miner.Miner/Mine',
            miner__pb2.MinerRequest.SerializeToString,
            miner__pb2.MinerResponse.FromString,
            options, channel_credentials,
            insecure, call_credentials, compression, wait_for_ready, timeout, metadata)