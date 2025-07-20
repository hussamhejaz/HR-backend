// swagger.js
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Swagger definition
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'HR Management API',
    version: '1.0.0',
    description: 'API documentation for HR system',
  },
  servers: [
    {
      url: 'http://localhost:5001',
      description: 'Development server',
    },
  ],
};

const options = {
  swaggerDefinition,
  apis: ['server.js'], // Path to the API docs
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = { swaggerUi, swaggerSpec };
