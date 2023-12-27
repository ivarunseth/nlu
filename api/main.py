from flask import Blueprint, render_template, jsonify, current_app

from . import stats

main = Blueprint('main', __name__)


@main.before_app_request
def before_request():
    """Update requests per second stats."""
    stats.add_request()


@main.route('/stats', methods=['GET'])
def get_stats():
    return jsonify({'requests_per_second': stats.requests_per_second()})
