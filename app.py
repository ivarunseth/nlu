from api import create_application

# Create an application instance that web servers can use. We store it as
# "application" (the wsgi default) and also the much shorter and convenient
# "app".
application, celery = app, celery = create_application()
with app.app_context() as app_ctx:
    app_ctx.push()
    if not app.config['TESTING']:
        from api.models import Language
        Language.update()

if __name__ == '__main__':    
    app.run(host='0.0.0.0', port='5000')
