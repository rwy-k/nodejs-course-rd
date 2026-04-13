export const appConfig = {
  grpcUrl: process.env.GRPC_URL || '0.0.0.0:5001',
  httpPort: parseInt(process.env.HTTP_PORT || '3001', 10),
};
