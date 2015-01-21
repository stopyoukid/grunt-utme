# grunt-utme

## Simple Server for Persisting Scenarios
```
   utmeServer: {
       app: {
           options: {
               directory: './test/utme_scenarios/' // The directory to use to persist/load scenarios from.
           }
       }
   },
```

## Testing on Continuous Integration

```
   utmeTestRunner: {
       test: {
           options: {
               port: 9064, // The port for the test server
               appServer: 'http://localhost:9000' // The URL to the application which has utme installed
           },
           files: [{ src: './test/utme_scenarios/' }] // The list of scenarios to run
       }
   },
```
